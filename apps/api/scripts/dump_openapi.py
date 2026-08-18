import json, sys
sys.path.insert(0, "src")
from app.main import app

if __name__ == "__main__":
    json.dump(app.openapi(), sys.stdout)
