from fastapi import APIRouter, Request, Depends, WebSocket, WebSocketDisconnect
from typing import Any, Dict, List

import traceback

async def socket_loop(context, websocket):
    while True:
        try:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                print(f"[INFO] Websocket disconnected by user: {message.get('code')}")
                break
            if message["type"] != "websocket.receive":
                continue
            data = message.get("bytes")

            if data is None:
                continue
            
            await context.audio_queue.put(data)
            print(f"[DEBUG] Received audio frame of length {len(data)} bytes")

        except WebSocketDisconnect as e:
            print(f"[WARN] WebSocket Disconnect by unknown error: code={e.code}")
            break

        except Exception as e:
            print(f"[WARN] Unexpected error in socket_loop: type={type(e).__name__}, detail={e!r}")
            traceback.print_exc()
            break

    await context.audio_queue.put(None)