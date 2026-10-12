from api.management.message_schema import TranscriptionMessage
import numpy as np
from constant.whisper import LANG_NAMES_TO_IDS
from dataclasses import dataclass, field
from custom.gradual_whisper import GradualWhisper


async def whisper_transcription(context, transcription_handle, redis_manager, redis_keymap): 
    custom_whisper = GradualWhisper()
    allowed_language_tokens = [LANG_NAMES_TO_IDS[lang] for lang in context.language_group]

    while True:
        message = None
        data = None
        stop_loop = False
        audio_task_done = False
        end_flag = False
        again = True
        
        try:
            data = await context.audio_queue.get()
            if data is None:
                context.audio_queue.task_done()
                audio_task_done = True
                stop_loop = True
                continue
            
            end_flag = data[0] == 1
            audio_chunk = np.frombuffer(data, dtype=np.float32, offset=1) 

            if len(audio_chunk) > 1:
                custom_whisper.add_audio_chunk(audio_chunk=audio_chunk)
                audio_with_context, frame_size = custom_whisper.get_audio()
                
                output, request_id = await transcription_handle.generate.remote(
                    encoder_input=audio_with_context,
                    decoder_input=custom_whisper.state.prompt, 
                    extra_args={
                        "audio-frame-size": frame_size, 
                        "allowed-languages": allowed_language_tokens,
                        "end": end_flag
                    },
                )

                transcription, language, again = custom_whisper.afterprocessing(output, end=end_flag)
                if again:
                    output, request_id = await transcription_handle.generate.remote(
                        encoder_input=audio_with_context,
                        decoder_input=custom_whisper.state.prompt, 
                        extra_args={
                            "audio-frame-size": frame_size, 
                            "allowed-languages": allowed_language_tokens,
                            "end": end_flag
                        },
                    )
                
            context.audio_queue.task_done()
            audio_task_done = True
        
        except Exception as e:
            message = TranscriptionMessage(
                type="transcription", 
                status="error",
                number=context.transcription_message_number, 
                complete="true" if end_flag else "false",
                language=language if language else "",
                result="Transcription Error",
                )
            print(f"[WARN] Unexpected error occured at transcription_loop: {e}")


        else:
            message = TranscriptionMessage(
                type="transcription", 
                status="success",
                number=context.transcription_message_number, 
                complete="true" if end_flag else "false",
                language=language if language else "",
                result=transcription,
                )
            
        finally:
            print(message)
            if data is not None and not audio_task_done:
                context.audio_queue.task_done()

            if message is not None:
                await redis_manager.update_stream(redis_keymap.stream_transcription, message.model_dump())
                if end_flag: 
                    await context.trans_queue.put(message)
                    context.transcription_message_number += 1
                elif custom_whisper.state.nth > 3 and custom_whisper.state.nth % 2 == 0:
                    print("give data when not finished")
                    await context.trans_queue.put(message)

            if stop_loop:
                break
        

    print("[INFO] Transcription loop ended.")
    await context.trans_queue.put(None)
