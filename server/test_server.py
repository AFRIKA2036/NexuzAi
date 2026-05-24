import urllib.request
import json

url = "http://localhost:8000/v1/chat/completions"
data = json.dumps({
    "messages": [{"role": "user", "content": "Hello"}]
}).encode('utf-8')

req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})

try:
    with urllib.request.urlopen(req) as response:
        for line in response:
            if line:
                print(line.decode('utf-8').strip())
except Exception as e:
    print(f"Error: {e}")
