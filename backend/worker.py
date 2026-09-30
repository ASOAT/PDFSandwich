import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import pdf_ops


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            operation = request["op"]
            if operation not in {"inspect", "save_original", "extract_page", "map_annotation", "selection_geometry", "texts", "export_pdf", "search"}:
                raise ValueError("Unknown operation")
            value = getattr(pdf_ops, operation)(**request.get("args", {}))
            response = {"id": request["id"], "result": value}
        except Exception as error:
            response = {"id": request.get("id"), "error": str(error)}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    if "--translate" in sys.argv or "--translate-server" in sys.argv:
        import translate
        translate.main("--translate-server" in sys.argv)
    else:
        main()
