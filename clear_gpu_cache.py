import torch
from GPUtil import showUtilization as gpu_usage


def free_gpu_cache():
    print("Initial GPU Usage")
    gpu_usage()

    # clear gpu memory cache
    torch.cuda.empty_cache()

    print("GPU Usage after emptying the cache")
    gpu_usage()


if __name__ == "__main__":
    free_gpu_cache()
