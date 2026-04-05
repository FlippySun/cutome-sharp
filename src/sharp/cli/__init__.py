"""Command-line-interface to run SHARP model.

For licensing see accompanying LICENSE file.
Copyright (C) 2025 Apple Inc. All Rights Reserved.
"""

import click

from . import predict

# 2026-04-05 | 修复 | 延迟导入 render 模块，避免在无 gsplat（CPU-only）环境下崩溃。
# render 子命令仅在 CUDA 环境下可用，CPU 部署时优雅跳过。
try:
    from . import render as _render_module

    _has_render = True
except ImportError:
    _has_render = False


@click.group()
def main_cli():
    """Run inference for SHARP model."""
    pass


main_cli.add_command(predict.predict_cli, "predict")
if _has_render:
    main_cli.add_command(_render_module.render_cli, "render")
