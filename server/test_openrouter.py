import httpx
import json
import os
import sys
from dotenv import load_dotenv

load_dotenv()
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

API_KEY = os.getenv("OPENROUTER_API_KEY")
URL = "https://openrouter.ai/api/v1/chat/completions"

def test_model(model_id):
    print(f"\n--- Testing Model: {model_id} ---")
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:8080",
        "X-Title": "NexuzAI Diagnostic"
    }
    
    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": "Say 'Model is working!'"}]
    }
    
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(URL, headers=headers, json=payload)
            if response.status_code == 200:
                data = response.json()
                content = data['choices'][0]['message']['content']
                print(f"SUCCESS: {content}")
                return True
            else:
                print(f"FAILED: Status {response.status_code}")
                print(f"Error: {response.text}")
                return False
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return False

if __name__ == "__main__":
    # Test a few models from our pool
    models_to_test = [
        "nvidia/nemotron-3-super-120b-a12b:free"
    ]
    
    for m in models_to_test:
        test_model(m)
