import inspect
import os
import librosa
import os
import time
from collections.abc import Sequence
from dataclasses import asdict
from dataclasses import dataclass, field
from typing import List, NamedTuple

from vllm import LLM, EngineArgs, PromptType, SamplingParams
from vllm.assets.audio import AudioAsset
from vllm.utils.argparse_utils import FlexibleArgumentParser
import numpy as np
import librosa
from collections import deque

# import tok
# whisper_tokenizer = tok.get_tokenizer(multilingual=True)

from gradual_whisper import GradualWhisper

def load_audio_as_numpy(file_path, target_sr=16000):
    y, sr = librosa.load(file_path, sr=target_sr, mono=True)
    return (y, sr)

def make_prompt(audio, state):
    prompt = {
        "encoder_prompt": {
            "prompt": "",
            "multi_modal_data": {"audio": audio},
        },
        "decoder_prompt": state.prompt,
    }

    sampling_params = SamplingParams(
        temperature=0,
        max_tokens=448,
        # detokenize=False,
        extra_args={"audio_frame": len(audio) / 16000 * 100, "allowed_languages": [50264, 50260, 50259]} 
    )
    return prompt, sampling_params

if __name__ == '__main__':
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

    customer = GradualWhisper()

    end = False
    for i in range(1): # isend
        if i == 11 or i == 25: end = True
        else: end = False

        audio_chunk, _ = load_audio_as_numpy(f"./new/capture_VAD ({i}).wav")
        audio_chunk_len = len(audio_chunk)
        
        customer.add_audio_chunk(audio_chunk=audio_chunk, end=end)
        
        prompt, sampling_params = make_prompt(customer.get_audio(), customer.state)
        output = llm.generate(prompt, sampling_params)[0]

        final_output = customer.afterprocessing(output)
        print(final_output)
