import inspect
import os
import librosa
import os
import time
from collections.abc import Sequence
from dataclasses import asdict
from typing import NamedTuple

from vllm import LLM, EngineArgs, PromptType, SamplingParams
from vllm.assets.audio import AudioAsset
from vllm.utils.argparse_utils import FlexibleArgumentParser
import numpy as np
import librosa
from collections import deque

# whisper_tokenizer = whisper_tokenizer.get_tokenizer(multilingual=True)
def load_audio_as_numpy(file_path, target_sr=16000):
    y, sr = librosa.load(file_path, sr=target_sr, mono=True)
    return (y, sr)


if __name__ == "__main__":
    os.environ["VLLM_WORKER_MULTIPROC_METHOD"] = "spawn"
    engine_args = EngineArgs(
        model="openai/whisper-large-v3-turbo",
        max_model_len=448,
        max_num_seqs=64,
        limit_mm_per_prompt={"audio": 1},
        dtype="half" ,
        gpu_memory_utilization=0.25,
        enforce_eager=True
    )

    llm = LLM(**asdict(engine_args))


    # for prompt, param in zip(prompt_list, params_list): 
    #     outputs = llm.generate(prompt, param)
    #     for output in outputs:
    #         print(output.request_id, output.outputs[0].text)

    #     print()

    # failed_chunk_index = None
    # failed_chunk_start_frame = None # 이전 청크의 프레임일 수도 있음
    # # 청크가 실패하면 이전 청크의 start 인덱스를 가져오기, 혹은 start 인덱스보다 하나 더 뒤의 인덱스 가져오기
    # last_chunk_index = 0
    # last_frame_index = 0 # 청크의 시작 기준으로 인덱싱

    frameSize = 1536 
    framePerChunk = 30 
    framePerPreSpeechPad = 8

    first_chunk = (frameSize * framePerPreSpeechPad) + (frameSize * framePerChunk * 3)

    sr = 16000
    audio_main_buffer = np.zeros(16000 * 30, dtype=np.float32)
    audio_main_buffer_pointer = 0

    audio_sub_buffer = np.zeros(16000 * 30, dtype=np.float32)
    audio_sub_buffer_pointer = 0

    for i in range(12):
        audio_chunk, _ = load_audio_as_numpy(f"./chunk/capture_VAD ({i}).wav")
        audio_chunk_len = len(audio_chunk)

        if audio_main_buffer_pointer < first_chunk:
            audio_main_buffer[audio_main_buffer_pointer:audio_main_buffer_pointer+audio_chunk_len] = audio_chunk
            audio_main_buffer_pointer += audio_chunk_len
            audio = audio_main_buffer[:audio_main_buffer_pointer]
            pp = "<|startoftranscript|><|ko|>"

        else:

            audio_main_buffer[:audio_sub_buffer_pointer] = audio_sub_buffer[:audio_sub_buffer_pointer]
            audio_main_buffer[audio_sub_buffer_pointer:audio_sub_buffer_pointer+audio_chunk_len] = audio_chunk

            audio = audio_main_buffer[:audio_sub_buffer_pointer + audio_chunk_len]
            audio_sub_buffer_pointer = 0

            pp = f"<|startofprev|>{"".join(words[:(len(words) // 2)])}<|startoftranscript|><|ko|>"



        audio_frame_len = len(audio) / sr * 100

        
 

        prompt = {
            "encoder_prompt": {
                "prompt": "",
                "multi_modal_data": {"audio": audio},
            },
            "decoder_prompt": pp #<|transcribe|><|notimestamps|>",
        }

        sampling_params = SamplingParams(
            max_tokens=448,
            skip_special_tokens=False,
            detokenize=False,
            extra_args={"audio_frame": audio_frame_len} 
        )

        outputs = llm.generate(prompt, sampling_params)
        for output in outputs:
            print(output.request_id, output.custom_output["token"][0])
            print(output.request_id, output.custom_output["end_frame"])

        words, word_tokens, word_token_indices = output.custom_output["token"]
        
        # middle_word_last_token_index = word_token_indices[len(words) // 2][-1]

        # # audio_idx = int(output.custom_output["end_frame"] * 2 // 100 * sr) 
        # # audio[audio_idx:]
        middle_word_last_token_index = int(output.custom_output["end_frame"] * 2 // 100 * sr) 
        audio_sub_buffer_pointer = len(audio) - middle_word_last_token_index
        audio_sub_buffer[:audio_sub_buffer_pointer] = audio[middle_word_last_token_index:] # 수정

        fail = None
        if fail:
            pass
        else:
            pass
