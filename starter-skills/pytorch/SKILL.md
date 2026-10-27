---
name: PyTorch training scripts
description: Conventions for small PyTorch models the Training bay can run and chart.
triggers: [pytorch, torch, neural, network, train, training, model.pt]
roles: [planner, builder, reviewer]
enabled: true
---

- One script per model (train.py) that runs with `python train.py` and no arguments; constants at the top (EPOCHS, LR, BATCH_SIZE, SEED).
- Pick the device in this order: cuda (NVIDIA, and AMD Radeon with a ROCm build of PyTorch, which also reports as cuda), then mps (Apple Silicon), then torch_directml if it imports (other Windows GPUs), then cpu. Print the device on start.
- Set torch.manual_seed(SEED). Keep data small or synthetic unless the goal names a dataset; download datasets only with torchvision/torchaudio helpers into ./data.
- Print exactly one line per epoch in the form `epoch 3 loss 0.4123` (add `val_loss` after it if there is a validation set). The Training bay charts these numbers.
- Save weights with torch.save(model.state_dict(), "model.pt") next to the script; never write outside the script's folder.
- List torch and every imported package in requirements.txt. No notebooks, no hidden network calls, no GPU-only code paths.
- Reviewer: reject scripts that would run for hours by default, write outside their folder, or never print loss.
