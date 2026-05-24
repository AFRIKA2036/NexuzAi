import httpx
import json
import os
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("OPENROUTER_API_KEY")
URL = "https://openrouter.ai/api/v1/models"

def fetch_free_models():
    print("\n--- Fetching Free Models from OpenRouter ---")
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(URL)
            if response.status_code == 200:
                data = response.json()
                free_models = []
                for model in data.get('data', []):
                    # Check if the model is free based on pricing
                    pricing = model.get('pricing', {})
                    if pricing.get('prompt') == "0" and pricing.get('completion') == "0":
                        free_models.append({
                            'id': model.get('id'),
                            'name': model.get('name'),
                            'context_length': model.get('context_length')
                        })
                
                print(f"Found {len(free_models)} free models:")
                for m in free_models:
                    print(f"- {m['id']} ({m['name']})")
                return free_models
            else:
                print(f"FAILED: Status {response.status_code}")
                return []
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return []

if __name__ == "__main__":
    fetch_free_models()
