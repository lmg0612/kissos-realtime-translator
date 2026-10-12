
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

aidio = AudioAsset("winning_call").audio_and_sample_rate
audio_path = os.path.join(os.path.dirname(__file__), "jfk.flac")
# y, sr = librosa.load('5s-ko.wav', sr=16000)
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
dummy_audio, _ = load_audio_as_numpy("./new.m4a")
prompt_list = []
sp_list = []
setting = [(1,9), (2,13), (3,10)]
now = setting[2]

for i in range(now[1]):
    audio, sr = load_audio_as_numpy(f"./audio{now[0]}/capture_VAD ({i}).wav")
    # print(audio.shape)
    prompt = {
        "encoder_prompt": {
        "prompt": "",
        "multi_modal_data": {
                "audio": audio#np.concatenate([audio, audio])
                },
            },
        "decoder_prompt": "<|startoftranscript|>",
    }
    prompt_list.append(prompt)

    audio_frame = len(audio) / sr * 100
    sampling_params = SamplingParams(
        temperature=0,
        max_tokens=448,
        skip_special_tokens=False,
        # detokenize=False,
        extra_args={"audio_frame": audio_frame}#{"audio_frame": aidio[0].shape[0] / aidio[1] * 100}1100 499
    )
    sp_list.append(sampling_params)

class ModelRequestData(NamedTuple):
    engine_args: EngineArgs
    prompts: Sequence[PromptType]

def run_whisper():
    os.environ["VLLM_WORKER_MULTIPROC_METHOD"] = "spawn"
    # module_path = inspect.getfile(EngineArgs)
    # print(f"모듈 위치: {module_path}")
    engine_args = EngineArgs(
        model="openai/whisper-large-v3-turbo",
        max_model_len=448,
        max_num_seqs=64,
        limit_mm_per_prompt={"audio": 1},
        dtype="half" ,
        gpu_memory_utilization=0.25,
        enforce_eager=True
    )

    # prompts = [
    #     {  # Test explicit encoder/decoder prompt
    #         "encoder_prompt": {
    #             "prompt": "",
    #             "multi_modal_data": {
    #                 "audio": y#AudioAsset("winning_call").audio_and_sample_rate#y,#aidio,
    #             },
    #         },
    #         "decoder_prompt": "<|startoftranscript|><|transcribe|><|notimestamps|>",
    #     },
    # ]*3
    prompts = prompt_list
    # prompts = [
    #     {  # Test explicit encoder/decoder prompt
    #         "encoder_prompt": {
    #             "prompt": "",
    #             "multi_modal_data": {
    #                 "audio": load_audio_as_numpy("./audios/capture_VAD (5).wav")[0]
    #             },
    #         },
    #         "decoder_prompt": "<|startoftranscript|>",
    #     },
             
    # ]

    #     {  # Test explicit encoder/decoder prompt
    #         "encoder_prompt": {
    #             "prompt": "",
    #             "multi_modal_data": {
    #                 "audio": load_audio_as_numpy("./recordings/1s-ko.wav"),
    #             },
    #         },
    #         "decoder_prompt": "<|startoftranscript|><|startoftranscript|>",
    #     },
    #     {  # Test explicit encoder/decoder prompt
    #         "encoder_prompt": {
    #             "prompt": "",
    #             "multi_modal_data": {
    #                 "audio": load_audio_as_numpy("./recordings/1s-ja.wav"),
    #             },
    #         },
    #         "decoder_prompt": "<|startoftranscript|><|startoftranscript|>",
    #     },
    #     {  # Test explicit encoder/decoder prompt
    #         "encoder_prompt": {
    #             "prompt": "",
    #             "multi_modal_data": {
    #                 "audio": load_audio_as_numpy("./recordings/5s-ko.wav"),
    #             },
    #         },
    #         "decoder_prompt": "<|startoftranscript|><|startoftranscript|>",
    #     },
    

    return ModelRequestData(
        engine_args=engine_args,
        prompts=prompts,
    )


model_example_map = {
    "whisper": run_whisper,
}


def parse_args():
    parser = FlexibleArgumentParser(
        description="Demo on using vLLM for offline inference with "
        "vision language models for text generation"
    )
    parser.add_argument(
        "--model-type",
        "-m",
        type=str,
        default="whisper",
        choices=model_example_map.keys(),
        help='Huggingface "model_type".',
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=0,
        help="Set the seed when initializing `vllm.LLM`.",
    )
    return parser.parse_args()


def main(args):
    model = args.model_type
    if model not in model_example_map:
        raise ValueError(f"Model type {model} is not supported.")

    req_data = model_example_map[model]()

    # Disable other modalities to save memory
    default_limits = {"image": 0, "video": 0, "audio": 0}
    req_data.engine_args.limit_mm_per_prompt = default_limits | dict(
        req_data.engine_args.limit_mm_per_prompt or {}
    )

    # module_path = inspect.getfile(LLM)
    # print(f"모듈 위치: {module_path}")

    engine_args = asdict(req_data.engine_args) | {"seed": args.seed}
    llm = LLM(**engine_args)

    # prompts = req_data.prompts
    # a, b = load_audio_as_numpy("./audios/capture_VAD (2).wav")
    
    # # Create a sampling params object.
    # sampling_params = SamplingParams(
    #     temperature=0,
    #     top_p=1.0,
    #     max_tokens=64,
    #     skip_special_tokens=False,
    #     extra_args={"audio_frame":len(a) / b * 100}#{"audio_frame": aidio[0].shape[0] / aidio[1] * 100}1100 499
    # )


    start = time.time()

    for _ in range(1): 
        time_A = time.time()
        outputs = llm.generate(prompt_list, sp_list)
        time_B = time.time()
        print(f"Single run time: {time_B - time_A} seconds")
        # print(outputs)
        for output in outputs:
            print(f"Request ID: {output.request_id}, Generated Text: {output.outputs[0].text}")
            print(f"Custom Output: {output.custom_output}")

        print()
        # Print the outputs.
        # for output in outputs:
        #     prompt = output.prompt
        #     generated_text = output.outputs[0].text
        #     print(f"Decoder prompt: {prompt!r}, Generated text: {generated_text!r}")

    duration = time.time() - start

    print("Duration:", duration)



if __name__ == "__main__":
    args = parse_args()
    main(args)