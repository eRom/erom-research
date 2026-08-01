import os, sys, json, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from recover_transcript import recover


class TestRecover(unittest.TestCase):
    def _write(self, lines):
        fd, p = tempfile.mkstemp(suffix=".jsonl"); os.close(fd)
        with open(p, "w", encoding="utf-8") as f:
            for o in lines:
                f.write(json.dumps(o) + "\n")
        return p

    def test_returns_last_model_planner_response(self):
        p = self._write([
            {"source": "MODEL", "type": "PLANNER_RESPONSE", "content": "premier"},
            {"source": "USER", "type": "X", "content": "bruit"},
            {"source": "MODEL", "type": "PLANNER_RESPONSE", "content": "dernier"},
        ])
        self.assertEqual(recover(p), "dernier")
        os.remove(p)

    def test_none_when_no_model_response(self):
        p = self._write([{"source": "USER", "type": "X", "content": "rien"}])
        self.assertIsNone(recover(p))
        os.remove(p)

    def test_skips_malformed_and_blank_lines(self):
        fd, p = tempfile.mkstemp(suffix=".jsonl"); os.close(fd)
        with open(p, "w", encoding="utf-8") as f:
            f.write("pas du json\n")
            f.write(json.dumps({"source": "MODEL", "type": "PLANNER_RESPONSE", "content": "ok"}) + "\n")
            f.write("\n")
        self.assertEqual(recover(p), "ok")
        os.remove(p)


if __name__ == "__main__":
    unittest.main()
