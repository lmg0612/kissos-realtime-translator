
from api.management.message_schema import TranslationMessage


async def general_translation(context, translator_handle, redis_manager, redis_keymap):
    now_language_group = []
    end_flag = False

    if len(context.language_group) < 2:
        print("[INFO] No translation_langs in transcription_loop")
        print("[INFO] Translation loop ended.")
        return

    while True:
        try:
            data = await context.trans_queue.get()
            if data is None and context.trans_queue._unfinished_tasks == 1: 
                context.trans_queue.task_done()
                break
            
            if data.status == "error": 
                raise RuntimeError(f"Transcription Error")
            
            end_flag = data.complete == "true"
            transcription_language, transcription_result = data.language, data.result
            now_language_group = [lang for lang in context.language_group if lang != transcription_language]

            result = await translator_handle.generate.remote(
                cur_lid=transcription_language,
                trans_langs=now_language_group,
                text=transcription_result,
            )
                
            context.trans_queue.task_done()

        except Exception as e:
            message = TranslationMessage(
                type="translation", 
                status="error",
                number=context.translation_message_number,
                complete="true" if end_flag else "false",
                language=", ".join(now_language_group),
                result="Translation Error"
                )
            
            print(f"[ERROR] translation_loop:while \n{e}")
            print(message)
            
        else:
            message = TranslationMessage(
                type="translation", 
                status="success",
                number=context.translation_message_number,
                complete="true" if end_flag else "false",
                language=", ".join(now_language_group),
                **result
                )
            print(message)
        finally:
            if message: await redis_manager.update_stream(redis_keymap.stream_translation, message.model_dump())
            if end_flag: context.translation_message_number += 1

            
            # print(f"[Translation] : {result}", flush=True)

    print("[INFO] Transcription loop ended.")