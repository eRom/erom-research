#!/usr/bin/env python3
"""Récupère la dernière réponse MODEL d'un transcript agy (plan B du bug stdout #76).
Usage: python3 recover_transcript.py <transcript.jsonl>. Imprime le contenu récupéré, sinon rien."""
import json
import sys


def recover(path):
    last = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get("source") == "MODEL" and o.get("type") == "PLANNER_RESPONSE" and o.get("content"):
                last = o["content"]
    return last


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(2)
    r = recover(sys.argv[1])
    if r:
        print(r)
