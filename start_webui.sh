#!/bin/bash
#eval "$(conda shell.bash hook)"
source /data/software/anaconda3/etc/profile.d/conda.sh
conda activate comfy
cd /data/software/webui
python launch.py --listen --port 8187 --api --share --no-gradio-queue

