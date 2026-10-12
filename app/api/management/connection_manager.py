import secrets
import string
from fastapi import WebSocket
from typing import Any, Dict, List, Set
from database.redis_manager import ManageKeyMap, ManagerSide
from constant.global_vars import SESSION_EXPIRE_SECONDS
from dataclasses import dataclass, field
import asyncio


# logging, swagger ui

@dataclass
class SessionHash:
    session_id: str
    session_state: str = "alive" # dead
    auth_sub: str | None = None
    auth_provider: str | None = None

class ConnectionManger:

    def __init__(self, redis):
        self.active_connections: Dict[WebSocket, str] = {}
        self.background_tasks: Set = set()
        self.redis_keymap = ManageKeyMap()
        self.redis_manager = ManagerSide(redis, self.redis_keymap)

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[websocket] = await self.get_session_id()
        session_id = self.active_connections[websocket]
        # 암호화해서 돌려줄 수도 있음
        return session_id

    async def disconnect(self, websocket, direct=False):
        session_id = self.active_connections.pop(websocket)
        task = asyncio.create_task(self.return_session_id(session_id, direct))
        task.add_done_callback(self.background_tasks.discard)
        self.background_tasks.add(task)
        
    async def get_session_id(self):
        make_session_id = lambda: ''.join(secrets.choice(string.digits) for _ in range(6))
        session_id = await self.redis_manager.get_session_id(make_session_id)
        return session_id

    async def return_session_id(self, session_id: str, direct=False):
        expire_seconds = 0 if direct else SESSION_EXPIRE_SECONDS
        await asyncio.sleep(expire_seconds) 
        await self.redis_manager.return_session_id(session_id)

    async def check_session_id(self, session_id: str):
        is_session = await self.redis_manager.check_session_id(session_id)
        return is_session

    # 세션 종료에 따라 listner에게 종료 신호 보내기 + 데이터 이관, listener는 세션 종료 신호를 받으면 남아있는 데이터를 db에서 가져가도록 하기
