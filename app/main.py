import asyncio
from functools import partial

import ray
from ray import serve

from fastapi import Depends, FastAPI, WebSocket, Request
from fastapi.sse import EventSourceResponse
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import redis.asyncio as redis_client


from deployment.transcriptor import DeployWhisper
from deployment.translator import DeployMiLMMT
from auth.oauth import AuthClaims, get_current_websocket_user
from api.auth import router as auth_router
from api.management.connection_manager import ConnectionManger
from api import speaker, listener




ray.init(_temp_dir="/data/tmp", ignore_reinit_error=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = redis_client.Redis(
            host='localhost',
            port=6380,
            db=0,
            decode_responses=True
        )
    app.state.connection_manager = ConnectionManger(app.state.redis)
    
    await app.state.redis.flushdb()
    yield
    await app.state.redis.close()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)

@serve.deployment
@serve.ingress(app)
class IngressServer:
    def __init__(self, transcriptor_handle, translator_handle):
        self.transcriptor_handle = transcriptor_handle
        self.translator_handle = translator_handle
        # self.manager = ConnectionManger()

        # app.router.lifespan_context = self.lifespan
        
    # @asynccontextmanager
    # async def lifespan(self, app: FastAPI):
    #     self.redis_manager.connect()
    #     self.redis_manager.cleanup()
    #     yield
    #     self.redis_manager.disconnect()

    # route prefix ?ъ슜
    @app.websocket("/api/streaming")
    async def websocket_endpoint(
        self, 
        websocket: WebSocket,
        auth_claims: AuthClaims = Depends(get_current_websocket_user), # 먼저 인증(의존성 주입)
    ):
        await speaker.stream(
            websocket,
            app.state.redis,
            app.state.connection_manager,
            self.transcriptor_handle, 
            self.translator_handle,
            auth_claims,
            )

    @app.get("/api/broadcast/{session_id}")
    async def websocket_endpoint(self, request: Request, session_id: str):
        return EventSourceResponse(
            listener.broadcast_generator(
                session_id,
                app.state.redis,
                app.state.connection_manager,
            ))
        

app_transcriptor = DeployWhisper.bind()
app_translator = DeployMiLMMT.bind()
app_ingress = IngressServer.bind(app_transcriptor, app_translator)