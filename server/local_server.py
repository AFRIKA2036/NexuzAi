import os
import json
import asyncio
import base64
import hashlib
import hmac
import time
import httpx
from typing import List, Optional, Union
from pydantic import BaseModel, Field, validator
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# Constants for validation
MAX_MESSAGES = 10
MAX_CONTENT_CHARS = 10000
ALLOWED_ROLES = {"system", "user", "assistant"}

class Message(BaseModel):
    role: str
    content: str

    @validator("role")
    def validate_role(cls, v):
        if v not in ALLOWED_ROLES:
            raise ValueError(f"Role must be one of {ALLOWED_ROLES}")
        return v

    @validator("content")
    def validate_content(cls, v):
        if not v.strip():
            raise ValueError("Content cannot be empty")
        if len(v) > MAX_CONTENT_CHARS:
            raise ValueError(f"Content exceeds maximum length of {MAX_CONTENT_CHARS} characters")
        return v

class ChatCompletionRequest(BaseModel):
    model: Optional[Union[str, List[str]]] = "auto"
    messages: List[Message]
    temperature: Optional[float] = Field(0.7, ge=0, le=1.2)
    max_tokens: Optional[int] = Field(2048, ge=1, le=4096)
    stream: Optional[bool] = False

    @validator("messages")
    def validate_messages(cls, v):
        if not v:
            raise ValueError("Messages list cannot be empty")
        if len(v) > MAX_MESSAGES:
            raise ValueError(f"Messages list exceeds maximum of {MAX_MESSAGES}")
        return v

# Development-only usage tracker used when LOCAL_PROXY_REQUIRE_AUTH=false.
usage_stats = {}

# Configuration
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
LOCAL_PROXY_REQUIRE_AUTH = os.getenv("LOCAL_PROXY_REQUIRE_AUTH", "true").lower() not in {"0", "false", "no"}
# Default to require auth in production; only disable with explicit LOCAL_PROXY_REQUIRE_AUTH=false+dev
# SECURITY: In production, this MUST be true. The dev default is now secure.
# Default to allow all in development if no origins specified
origins_env = os.getenv("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [o.strip() for o in origins_env.split(",") if o.strip()] if origins_env else ["*"]
FREE_DAILY_LIMIT = int(os.getenv("FREE_DAILY_LIMIT", "2"))
NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL_PATH = os.getenv("MODEL_PATH", "./server/models/google_gemma-4-31B-it-Q4_K_M.gguf")

DEFAULT_OPENROUTER_MODELS = [
    model.strip()
    for model in os.getenv(
        "OPENROUTER_MODEL_FALLBACKS",
        "nvidia/nemotron-3-super-120b-a12b:free",
    ).split(",")
    if model.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://*.supabase.co; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com; img-src 'self' data: https://*.supabase.co; connect-src 'self' http://localhost:8000 https://*.supabase.co https://api.paystack.co https://openrouter.ai https://integrate.api.nvidia.com; frame-ancestors 'none';"
    return response

# Model Pool for Routing with Fallbacks (Verified May 2026)
MODEL_POOL = {
    "reasoning": DEFAULT_OPENROUTER_MODELS,
    "creative": DEFAULT_OPENROUTER_MODELS,
    "coding": DEFAULT_OPENROUTER_MODELS,
    "fast": DEFAULT_OPENROUTER_MODELS,
}

def route_model(messages):
    """Simple heuristic-based router to select the best model fallback list."""
    full_text = " ".join([m.get("content", "").lower() for m in messages]).strip()
    
    # Coding check
    if any(k in full_text for k in ["python", "javascript", "code", "function", "debug", "class", "algorithm"]):
        return MODEL_POOL["coding"]
    
    # Reasoning check
    if any(k in full_text for k in ["analyze", "evaluate", "compare", "complex", "reason", "logic", "strategy"]):
        return MODEL_POOL["reasoning"]
        
    # Creative/Writing check
    if any(k in full_text for k in ["write", "story", "poem", "email", "resume", "content", "creative"]):
        return MODEL_POOL["creative"]
        
    # Default to general/fast
    return MODEL_POOL["fast"]

def verify_supabase_jwt(token):
    if not SUPABASE_JWT_SECRET:
        raise HTTPException(status_code=500, detail="Supabase JWT verification is not configured")

    try:
        header_segment, payload_segment, signature_segment = token.split(".")
        header = json.loads(base64url_decode(header_segment))
        claims = json.loads(base64url_decode(payload_segment))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Supabase session")

    if header.get("alg") != "HS256":
        raise HTTPException(status_code=401, detail="Invalid Supabase session")

    signed = f"{header_segment}.{payload_segment}".encode("utf-8")
    expected = hmac.new(SUPABASE_JWT_SECRET.encode("utf-8"), signed, hashlib.sha256).digest()
    provided = base64url_decode(signature_segment)
    if not hmac.compare_digest(expected, provided):
        raise HTTPException(status_code=401, detail="Invalid Supabase session")

    now = int(time.time())
    if int(claims.get("exp", 0)) <= now:
        raise HTTPException(status_code=401, detail="Supabase session expired")
    if claims.get("nbf") and int(claims["nbf"]) > now:
        raise HTTPException(status_code=401, detail="Invalid Supabase session")

    audience = claims.get("aud")
    if audience != "authenticated" and "authenticated" not in (audience if isinstance(audience, list) else []):
        raise HTTPException(status_code=401, detail="Invalid Supabase session")
    if SUPABASE_URL and claims.get("iss") != f"{SUPABASE_URL}/auth/v1":
        raise HTTPException(status_code=401, detail="Invalid Supabase session")
    if claims.get("role") != "authenticated" or not claims.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid Supabase session")
    return claims

def base64url_decode(segment):
    padded = segment + "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(padded.encode("utf-8"))

async def load_profile_plan(user_id):
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return "free"

    url = f"{SUPABASE_URL}/rest/v1/profiles"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    params = {
        "id": f"eq.{user_id}",
        "select": "plan",
        "limit": "1",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=headers, params=params)
            response.raise_for_status()
            rows = response.json()
            plan = rows[0].get("plan") if rows else "free"
            return plan if plan in {"free", "pro", "team"} else "free"
    except Exception as e:
        print(f"Profile plan lookup failed for {user_id}: {e}")
        return "free"

async def get_request_user(request):
    if not LOCAL_PROXY_REQUIRE_AUTH:
        email = request.headers.get("X-User-Email")
        plan = request.headers.get("X-User-Plan", "free")
        if not email or email == "null":
            raise HTTPException(status_code=401, detail="Please login to use AI agents")
        return {
            "id": email,
            "email": email,
            "plan": plan if plan in {"free", "pro", "team"} else "free",
            "access_token": None,
        }
    else:
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Supabase session required")

        claims = verify_supabase_jwt(auth_header.removeprefix("Bearer ").strip())
        user_id = claims["sub"]
        plan = await load_profile_plan(user_id)
        return {
            "id": user_id,
            "email": claims.get("email") or user_id,
            "plan": plan,
            "access_token": auth_header.removeprefix("Bearer ").strip(),
        }

async def consume_usage_limit(user):
    if not LOCAL_PROXY_REQUIRE_AUTH:
        if user["plan"] in {"pro", "team"}:
            return

        count = usage_stats.get(user["id"], 0)
        if count >= 2:
            raise HTTPException(status_code=429, detail="Free limit reached (2 requests). Upgrade to Pro for unlimited use!")

        usage_stats[user["id"]] = count + 1
        print(f"Dev usage for {user['email']}: {usage_stats[user['id']]}/2")
        return

    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=500, detail="Supabase usage enforcement is not configured")

    url = f"{SUPABASE_URL}/rest/v1/rpc/consume_daily_usage"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {user['access_token']}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, headers=headers, json={"p_limit": FREE_DAILY_LIMIT})
            response.raise_for_status()
            usage_rows = response.json()
    except Exception as e:
        print(f"Usage RPC failed for {user['email']}: {e}")
        raise HTTPException(status_code=500, detail="Usage check failed")

    usage = usage_rows[0] if isinstance(usage_rows, list) and usage_rows else usage_rows
    if not usage or not usage.get("allowed"):
        request_count = usage.get("request_count", FREE_DAILY_LIMIT) if isinstance(usage, dict) else FREE_DAILY_LIMIT
        raise HTTPException(
            status_code=429,
            detail=f"Free daily limit reached ({request_count}/{FREE_DAILY_LIMIT}). Upgrade to Pro for unlimited use!"
        )

# Lazy load the local model to save resources
llm = None

def get_llm():
    global llm
    if llm is None:
        try:
            from llama_cpp import Llama
            if os.path.exists(MODEL_PATH):
                print(f"Loading local model from {MODEL_PATH}...")
                llm = Llama(model_path=MODEL_PATH, n_ctx=4096, n_gpu_layers=-1, verbose=False)
            else:
                print(f"Model file not found at {MODEL_PATH}. Falling back to Simulation Mode.")
        except ImportError:
            print("llama-cpp-python not installed. Falling back to Simulation Mode.")
        except Exception as e:
            print(f"Error loading model: {e}. Falling back to Simulation Mode.")
    return llm

async def local_inference_stream(messages, system_prompt):
    model = get_llm()
    if model:
        # Real Inference
        prompt = f"<|system|>\n{system_prompt}\n<|user|>\n{messages[-1]['content']}\n<|assistant|>\n"
        stream = model(prompt, max_tokens=2048, stream=True, stop=["<|endoftext|>", "<|user|>"])
        for chunk in stream:
            text = chunk['choices'][0]['text']
            yield f"data: {json.dumps({'choices': [{'delta': {'content': text}}]})}\n\n"
        yield "data: [DONE]\n\n"
    else:
        # Simulation Mode (Generic & Safe)
        yield f"data: {json.dumps({'choices': [{'delta': {'content': '<thought>'}}]})}\n\n"
        await asyncio.sleep(0.5)
        thoughts = ["Establishing secure neural link...", "Processing request parameters...", "Optimizing local resources..."]
        for t in thoughts:
            chunk_text = t + "\n"
            yield f"data: {json.dumps({'choices': [{'delta': {'content': chunk_text}}]})}\n\n"
            await asyncio.sleep(0.3)
        thought_end = "</thought>\n\n"
        yield f"data: {json.dumps({'choices': [{'delta': {'content': thought_end}}]})}\n\n"
        response = "NexuzAI is currently running in **Offline Mode**. To enable full AI intelligence, please switch to **Cloud Mode** in the navigation bar or ensure the local AI engine is properly configured."
        for word in response.split():
            yield f"data: {json.dumps({'choices': [{'delta': {'content': word + ' '}}]})}\n\n"
            await asyncio.sleep(0.05)
        yield "data: [DONE]\n\n"

async def openrouter_proxy_stream(body):
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://github.com/gemini-cli/ai-agents-app",
        "X-Title": "Gemini CLI AI Agents App",
    }
    
    # Handle Smart Routing with Fallbacks
    if "model" not in body or not body["model"] or body["model"] == "auto":
        routed_models = route_model(body.get("messages", []))
        if isinstance(routed_models, list):
            body["models"] = routed_models
            if "model" in body:
                del body["model"]
            print(f"Smart Router selected fallbacks: {body['models']}")
        else:
            body["model"] = routed_models
            print(f"Smart Router selected: {body['model']}")
    elif isinstance(body.get("model"), list):
        # If the frontend already sent a list in 'model', move it to 'models'
        body["models"] = body.pop("model")[:6]
    elif not body.get("models"):
        body["models"] = DEFAULT_OPENROUTER_MODELS
        body.pop("model", None)
        
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0, read=None)) as client:
            async with client.stream("POST", OPENROUTER_API_URL, json=body, headers=headers) as r:
                if r.status_code != 200:
                    error_text = await r.aread()
                    provider_error = parse_provider_error(error_text)
                    print(f"OpenRouter Error: {r.status_code} - {provider_error}")
                    yield f"data: {json.dumps({'error': {'message': f'OpenRouter Error {r.status_code}: {provider_error}'}})}\n\n"
                    return

                async for line in r.aiter_lines():
                    if line:
                        yield line + "\n\n"
    except Exception as e:
        print(f"Proxy Error: {e}")
        yield f"data: {json.dumps({'error': {'message': str(e)}})}\n\n"
        yield "data: [DONE]\n\n"

def parse_provider_error(error_bytes):
    text = error_bytes.decode("utf-8", errors="replace")
    try:
        data = json.loads(text)
        error = data.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if isinstance(error, str):
            return error
    except Exception:
        pass
    return text[:500] or "unknown provider error"

async def cloud_proxy_stream(body):
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {NVIDIA_API_KEY}",
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", NVIDIA_API_URL, json=body, headers=headers) as r:
                async for line in r.aiter_lines():
                    if line:
                        yield line + "\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': {'message': str(e)}})}\n\n"
        yield "data: [DONE]\n\n"

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "mode": "openrouter" if OPENROUTER_API_KEY else "simulation",
        "auth": "supabase-jwt" if LOCAL_PROXY_REQUIRE_AUTH else "insecure-dev",
    }

@app.post("/v1/chat/completions")
async def chat_completions(req_body: ChatCompletionRequest, request: Request):
    body = req_body.dict()
    use_local = request.headers.get("X-Use-Local") == "true"
    user = await get_request_user(request)
    await consume_usage_limit(user)

    if use_local:
        messages = body.get("messages", [])
        system_prompt = next((m["content"] for m in messages if m["role"] == "system"), "")
        return StreamingResponse(local_inference_stream(messages, system_prompt), media_type="text/event-stream")
    elif OPENROUTER_API_KEY:
        return StreamingResponse(openrouter_proxy_stream(body), media_type="text/event-stream")
    else:
        return StreamingResponse(cloud_proxy_stream(body), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
