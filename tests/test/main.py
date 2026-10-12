
import inspect
import os
import os
import time
from collections.abc import Sequence
from dataclasses import asdict
from typing import NamedTuple

from vllm import LLM, EngineArgs, PromptType, SamplingParams
from vllm.assets.audio import AudioAsset
from vllm.utils.argparse_utils import FlexibleArgumentParser
import json
import numpy as np
import librosa

def load_audio_as_numpy(file_path, target_sr=16000):
    """
    - sr=16000: 로드 시 바로 16kHz로 리샘플링
    - mono=True: 다채널 오디오를 모노로 병합
    """
    # librosa.load는 기본적으로 1D numpy array를 반환합니다.
    y, sr = librosa.load(file_path, sr=target_sr, mono=True)
    
    return (y, sr)


def loop(llm):
    (audio, sr) = AudioAsset("mary_had_lamb").audio_and_sample_rate
    prompt = [
        { 
            "encoder_prompt": {
                "prompt": "",
                "multi_modal_data": {
                    "audio": audio,
                },
            },
            "decoder_prompt": "<|startoftranscript|>",
        },
    ]
    sampling_params = SamplingParams(
        max_tokens=64,
        # detokenize=False,
        skip_special_tokens=False,
        extra_args={"audio_frame": len(audio) // sr * 100},
    )

    print("[INFO] start warming up")
    outputs = llm.generate(prompt*20, sampling_params)
    print("[INFO] end warming up")

    start = time.time()


    results = {}
    for batch_size in [20, 30, 40]:
        batched_prompt = prompt * batch_size

        # 배치 기준
        all_single_batch_runtime = []
        # 개별 요청 기준 
        all_generation_time = []
        # all_token_length = []
        all_tps = []
        all_ttft = []

        for _ in range(30): 
            time_single_batch_start = time.time()
            outputs = llm.generate(batched_prompt, sampling_params)
            time_single_batch_end = time.time()

            single_runtime = time_single_batch_end - time_single_batch_start
            all_single_batch_runtime.append(single_runtime)

            for output in outputs:
                metrics = output.metrics
                token_length = metrics.num_generation_tokens
                ttft = metrics.first_token_latency
                generation_time = ttft + (metrics.last_token_ts - metrics.first_token_ts)
                tps = token_length / generation_time

                all_generation_time.append(generation_time)
                all_tps.append(tps)
                all_ttft.append(ttft)

                # generated_text = output.outputs[0].text
                # print(f"Decoder prompt: {prompt!r}, Generated text: {generated_text!r}")
        single_batch_runtime_mean = np.mean(all_single_batch_runtime)
        single_batch_runtime_median = np.median(all_single_batch_runtime)
        genaration_time_mean = np.mean(all_generation_time)
        genaration_time_median = np.median(all_generation_time)
        tps_mean = np.mean(all_tps)
        tps_median = np.median(all_tps)
        ttft_mean = np.mean(all_ttft)
        ttft_median = np.median(all_ttft)

        result = {}
        result["single_batch_runtime_mean"] = np.mean(all_single_batch_runtime)
        result["single_batch_runtime_median"] = np.median(all_single_batch_runtime)
        result["genaration_time_mean"] = np.mean(all_generation_time)
        result["genaration_time_median"] = np.median(all_generation_time)
        result["tps_mean"] = np.mean(all_tps)
        result["tps_median"] = np.median(all_tps)
        result["ttft_mean"] = np.mean(all_ttft)
        result["ttft_median"] = np.median(all_ttft)

        results[batch_size] = result

        # print(f"\n[Single Batch][BatchSize={batch_size}]")
        # print(f"single_batch_runtime_mean: {single_batch_runtime_mean}")
        # print(f"single_batch_runtime_median: {single_batch_runtime_median}")
        # print(f"genaration_time_mean: {genaration_time_mean}")
        # print(f"genaration_time_median: {genaration_time_median}")
        # print(f"tps_mean: {tps_mean}")
        # print(f"tps_median: {tps_median}")
        # print(f"tps_mean: {ttft_mean}")
        # print(f"tps_median: {ttft_median}")

            # print(outputs)
    # print("RPS:", len(prompts) / duration)

    return results
if __name__ == "__main__":
    os.environ["VLLM_WORKER_MULTIPROC_METHOD"] = "spawn"
    engine_args = EngineArgs(
        model="openai/whisper-large-v3-turbo",
        max_model_len=448,
        max_num_seqs=64,
        limit_mm_per_prompt={"audio": 1},
        dtype="half",
        gpu_memory_utilization=0.2,
        enforce_eager=True
    )
    llm = LLM(**asdict(engine_args))
    results = loop(llm)
    with open("main_final.json", "w", encoding="utf-8") as f:
        # indent=4를 주면 보기 좋게 들여쓰기가 됩니다
        json.dump(results, f, indent=4, ensure_ascii=False)

