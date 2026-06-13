# NexuzAI Local Proxy - Dockerfile
# Runs the FastAPI proxy with llama.cpp for local LLM inference
# Supports both CPU and GPU (NVIDIA) inference

FROM python:3.11-slim

# Install system dependencies for llama-cpp-python
# libgomp1 for OpenMP, nvidia-container-toolkit for GPU
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY server/requirements.txt .

# Install Python dependencies
# Use --no-cache-dir to reduce image size
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy the server code
COPY server/ ./server/

# Create directory for models (will be mounted as volume)
RUN mkdir -p /app/models

# Environment variables with defaults
ENV MODEL_PATH="/app/models/google_gemma-4-31B-it-Q4_K_M.gguf"
ENV HOST="0.0.0.0"
ENV PORT="8000"
ENV LOCAL_PROXY_REQUIRE_AUTH="false"
ENV FREE_DAILY_LIMIT="2"
ENV ALLOWED_ORIGINS="*"
ENV OPENROUTER_API_KEY=""
ENV NVIDIA_API_KEY=""

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the server
# Use exec form for proper signal handling
CMD ["python", "-m", "uvicorn", "server.local_server:app", "--host", "0.0.0.0", "--port", "8000"]