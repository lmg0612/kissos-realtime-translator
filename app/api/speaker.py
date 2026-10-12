import asyncio
import json
import traceback

import redis.asyncio as redis
from fastapi import APIRouter, Request, Depends, WebSocket, WebSocketDisconnect
from ray.serve.handle import DeploymentHandle

from auth.oauth import AuthClaims
from database.redis_manager import SessionKeyMap, SpeakerSide
from api.management.message_schema import SystemMessage
from api.management.connection_manager import ConnectionManger
from api.speaker_helper import websocket_loop, transcription_loop, translation_loop
from api.speaker_helper.context_specs import SpeakerContext


async def stream(
    websocket: WebSocket,
    redis: redis,
    connection_manager: ConnectionManger,
    transcriptor_handle: DeploymentHandle,
    translator_handle: DeploymentHandle,
    auth_claims: AuthClaims
    ):

    try:
        session_id = await connection_manager.connect(websocket)
        initial_message = await asyncio.wait_for(websocket.receive_json(), timeout=3.0)
        initial_message = initial_message.get("payload", initial_message)

        print(f"[INFO] WebSocket connection accepted: {auth_claims.sub}")
        print(f"[INFO] Session ID: {session_id}")

        await websocket.send_json({
            "type": "session",
            "payload": {
                "pin": session_id,
                "sessionId": session_id,
                "broadcastUrl": f"/api/broadcast/{session_id}",
            }
        })

    except Exception as e:
        print(f"[INFO] Websocket initial/auth connection failed: {e}")
        try:
            await websocket.send_json({
                "type": "auth_error",
                "message": "Authentication failed"
            })
            await websocket.close(code=1008)
        except Exception as e:
            pass
        finally:
            await connection_manager.disconnect(websocket, direct=True)

    try:
        redis_keymap = SessionKeyMap(session_id)
        redis_manager = SpeakerSide(redis, redis_keymap)
        context = SpeakerContext(session_id, redis_keymap)
        context.language_group = initial_message["languages"]
        
        message = SystemMessage(
            type="system-message",
            status="success",
            condition="alive",
            detail="Websocket successfully Connected"
        )
        await redis_manager.update_stream(
            redis_keymap.stream_system_message, 
            message.model_dump()
            )
        await redis_manager.update_hash({
            "pin": session_id,
            "auth_sub": auth_claims.sub,
            "auth_provider": auth_claims.provider,
            "language_group": json.dumps(context.language_group)
        })


        tasks = [
            asyncio.create_task(websocket_loop.socket_loop(context, websocket), name="socket_loop"),
            asyncio.create_task(transcription_loop.whisper_transcription(context, transcriptor_handle, redis_manager, redis_keymap), name="transcription_loop"),
            asyncio.create_task(translation_loop.general_translation(context, translator_handle, redis_manager, redis_keymap), name="translation_loop")
        ]

        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
        for task in done:
            exc = task.exception()
            if exc:
                print(f"[TASK ERROR] {task.get_name()}: {type(exc).__name__}: {exc}", flush=True)
                traceback.print_exception(type(exc), exc, exc.__traceback__)
                for pending_task in pending:
                    pending_task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                raise exc

        if pending:
            await asyncio.gather(*pending)
        # 비정상 종료상태가 30분이 넘으면 강제종료하기

    except asyncio.TimeoutError as e:
        return
    except (KeyError, json.JSONDecodeError) as e:
        return 
    except Exception as e:
        print(f"Unexpected error in main stream function: {e}")
        traceback.print_exc()

    finally:
        await connection_manager.disconnect(websocket)
        message = SystemMessage(
            type="system-message",
            status="success",
            condition="dead",
            detail="Connection successfully disconnected"
        )
        await redis_manager.update_stream(redis_keymap.stream_system_message, message.model_dump())
        await redis_manager.set_expire()
        