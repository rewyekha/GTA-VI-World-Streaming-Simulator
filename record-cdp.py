#!/usr/bin/env python3
"""Capture the live Chrome tab through Chrome DevTools Protocol, no Python packages."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import time
import urllib.request
import urllib.parse

ROOT = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def ws_send(sock, value):
    payload = json.dumps(value).encode()
    mask = os.urandom(4)
    n = len(payload)
    header = bytes([0x81, 0x80 | (n if n < 126 else 126 if n < 65536 else 127)])
    if n >= 65536:
        header += struct.pack("!Q", n)
    elif n >= 126:
        header += struct.pack("!H", n)
    sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))


def read_exact(sock, count):
    chunks = bytearray()
    while len(chunks) < count:
        part = sock.recv(count - len(chunks))
        if not part:
            raise EOFError("Chrome closed its DevTools connection")
        chunks.extend(part)
    return bytes(chunks)


def ws_read(sock):
    first, second = read_exact(sock, 2)
    opcode, size = first & 0x0F, second & 0x7F
    if size == 126:
        size = struct.unpack("!H", read_exact(sock, 2))[0]
    elif size == 127:
        size = struct.unpack("!Q", read_exact(sock, 8))[0]
    mask = read_exact(sock, 4) if second & 0x80 else None
    body = read_exact(sock, size)
    if mask:
        body = bytes(b ^ mask[i % 4] for i, b in enumerate(body))
    return opcode, body


def jpeg_dimensions(data):
    i = 2
    while i < len(data) - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        i += 2
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            return struct.unpack("!HH", data[i + 3:i + 7])[::-1]
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            continue
        length = struct.unpack("!H", data[i:i + 2])[0]
        i += length
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration", type=int, default=72)
    parser.add_argument("--port", type=int, default=9222)
    args = parser.parse_args()
    output = ROOT / "output"
    output.mkdir(exist_ok=True)
    final_video = output / "open-world-streaming-demo.mp4"
    final_video.unlink(missing_ok=True)
    frames = Path(tempfile.mkdtemp(prefix="stream-demo-frames-"))
    profile = Path(tempfile.mkdtemp(prefix="stream-demo-chrome-"))
    chrome = subprocess.Popen([
        CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
        f"--remote-debugging-port={args.port}", "--remote-allow-origins=*",
        f"--user-data-dir={profile}", "--window-size=1280,720", "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    sock = None
    try:
        target = None
        for _ in range(100):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{args.port}/json/list", timeout=1) as response:
                    tabs = json.load(response)
                target = next(t for t in tabs if t.get("type") == "page")
                break
            except Exception:
                time.sleep(.2)
        if not target:
            raise RuntimeError("Chrome DevTools did not start on the requested port")
        address = target["webSocketDebuggerUrl"].replace("localhost", "127.0.0.1")
        parsed = urllib.parse.urlparse(address)
        sock = socket.create_connection((parsed.hostname, parsed.port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        path = parsed.path + ("?" + parsed.query if parsed.query else "")
        sock.sendall((f"GET {path} HTTP/1.1\r\nHost: {parsed.hostname}:{parsed.port}\r\n"
                      f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                      "Sec-WebSocket-Version: 13\r\nOrigin: http://localhost\r\n\r\n").encode())
        handshake = b""
        while b"\r\n\r\n" not in handshake:
            handshake += sock.recv(4096)
        if b" 101 " not in handshake:
            raise RuntimeError("Chrome rejected the DevTools WebSocket handshake")
        sock.settimeout(2)
        command_id = 0

        def command(method, params=None):
            nonlocal command_id
            command_id += 1
            ident = command_id
            ws_send(sock, {"id": ident, "method": method, "params": params or {}})
            while True:
                opcode, raw = ws_read(sock)
                if opcode == 8:
                    raise EOFError("Chrome closed the DevTools connection")
                if opcode != 1:
                    continue
                message = json.loads(raw)
                if message.get("id") == ident:
                    if "error" in message:
                        raise RuntimeError(message["error"].get("message", "DevTools command failed"))
                    return message.get("result", {})

        command("Page.enable")
        command("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 720, "deviceScaleFactor": 1, "mobile": False})
        command("Page.startScreencast", {"format": "jpeg", "quality": 78, "maxWidth": 1280, "maxHeight": 720, "everyNthFrame": 1})
        command("Page.navigate", {"url": "http://localhost:8000/?demo=1"})
        print("Browser viewport:", command("Page.getLayoutMetrics").get("cssVisualViewport"), flush=True)
        print(f"Recording the live demo for {args.duration}s at 1280x720…", flush=True)
        deadline = time.monotonic() + args.duration
        count = 0
        while time.monotonic() < deadline:
            try:
                opcode, raw = ws_read(sock)
            except socket.timeout:
                continue
            if opcode == 8:
                raise EOFError("Chrome stopped the recording")
            if opcode != 1:
                continue
            message = json.loads(raw)
            if message.get("method") != "Page.screencastFrame":
                continue
            params = message["params"]
            image = base64.b64decode(params["data"])
            if count == 0:
                print("Captured frame size:", jpeg_dimensions(image), flush=True)
            (frames / f"frame-{count:06d}.jpg").write_bytes(image)
            count += 1
            ws_send(sock, {"id": command_id + 1, "method": "Page.screencastFrameAck", "params": {"sessionId": params["sessionId"]}})
            command_id += 1
        command("Page.stopScreencast")
        if count < 30:
            raise RuntimeError(f"Only received {count} frames; refusing to write a short/fabricated video")
        print(f"Captured {count} browser frames; encoding H.264…", flush=True)
        subprocess.run(["/usr/bin/swiftc", str(ROOT / "frames-to-mp4.swift"), "-o", "/tmp/frames-to-mp4"], check=True)
        fps = max(1, round(count / args.duration))
        subprocess.run(["/tmp/frames-to-mp4", str(frames), str(final_video), str(fps)], check=True)
        size = final_video.stat().st_size
        if size < 100_000:
            raise RuntimeError(f"Encoded file is unexpectedly small ({size} bytes)")
        print(f"Saved {final_video} ({size:,} bytes)")
    finally:
        if sock:
            sock.close()
        chrome.terminate()
        try:
            chrome.wait(timeout=5)
        except subprocess.TimeoutExpired:
            chrome.kill()
        import shutil
        shutil.rmtree(frames, ignore_errors=True)
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
