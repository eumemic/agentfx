# pymath_worker.py — a NON-TypeScript (Python) worker that DECLARES a contract.
# It registers pymath::add with request/response JSON Schemas. The engine stores them,
# and `npm run gen` derives TypeScript types from them — so agentfx (TS) can call this
# Python function with full static typing, without anyone writing TS for it.
#
# Run with the quickstart math-worker venv (which has iii-sdk):
#   III_URL=ws://localhost:49134 \
#   ../quickstart/workers/math-worker/.venv/bin/python pymath_worker.py
import os
from iii import register_worker, InitOptions

w = register_worker(
    os.environ.get("III_URL", "ws://localhost:49134"),
    InitOptions(worker_name="pymath"),
)

ADD_IN = {
    "type": "object",
    "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}},
    "required": ["a", "b"],
    "additionalProperties": False,
}
ADD_OUT = {
    "type": "object",
    "properties": {"sum": {"type": "integer"}},
    "required": ["sum"],
    "additionalProperties": False,
}


def add(payload: dict) -> dict:
    return {"sum": payload["a"] + payload["b"]}


w.register_function("pymath::add", add, request_format=ADD_IN, response_format=ADD_OUT)
print("pymath ready - registered pymath::add with a declared contract", flush=True)
