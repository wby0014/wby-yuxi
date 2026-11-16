import os
from pathlib import Path

import aiofiles
import yaml

from yuxi import get_version


async def load_info_config():
    """读取品牌配置，并在 YAML 解析后展开产品名与版本。"""
    static_dir = Path(__file__).resolve().parents[1] / "config" / "static"
    config_path = Path(os.environ.get("YUXI_BRAND_FILE_PATH", str(static_dir / "info.local.yaml")))
    if not config_path.exists():
        config_path = static_dir / "info.template.yaml"

    async with aiofiles.open(config_path, encoding="utf-8") as file:
        config = yaml.safe_load(await file.read())

    branding = config.get("branding") if isinstance(config, dict) else None
    name = branding.get("name") if isinstance(branding, dict) else None
    if not isinstance(name, str) or not name.strip():
        raise ValueError("品牌配置 branding.name 必须是非空字符串")
    branding["name"] = name = name.strip()
    version = get_version()

    def expand(value):
        """展开已解析的数据，避免名称中的引号改变 YAML 结构。"""
        if isinstance(value, str):
            return value.replace("{{PRODUCT_NAME}}", name).replace("{{YUXI_VERSION}}", version)
        if isinstance(value, dict):
            return {key: expand(item) for key, item in value.items()}
        if isinstance(value, list):
            return [expand(item) for item in value]
        return value

    return expand(config)
