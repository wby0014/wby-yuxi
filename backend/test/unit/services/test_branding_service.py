import pytest
import yaml

from yuxi.services import branding_service
from yuxi.services.branding_service import load_info_config

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_product_name_expands_after_yaml_parsing(tmp_path, monkeypatch):
    name = '团队 "知识" & 工作台'
    config = {
        "organization": {"name": "{{PRODUCT_NAME}}"},
        "branding": {"name": name, "subtitles": ["欢迎使用 {{PRODUCT_NAME}}"]},
        "footer": {"copyright": "© {{PRODUCT_NAME}} v{{YUXI_VERSION}}"},
    }
    brand_file = tmp_path / "brand.yaml"
    brand_file.write_text(yaml.safe_dump(config, allow_unicode=True), encoding="utf-8")
    monkeypatch.setenv("YUXI_BRAND_FILE_PATH", str(brand_file))

    result = await load_info_config()

    assert result["branding"]["name"] == name
    assert result["organization"]["name"] == name
    assert result["branding"]["subtitles"] == [f"欢迎使用 {name}"]
    assert result["footer"]["copyright"].startswith(f"© {name} v")
    assert "{{YUXI_VERSION}}" not in result["footer"]["copyright"]


async def test_missing_override_uses_template_and_ignores_working_directory(tmp_path, monkeypatch):
    package = tmp_path / "package" / "yuxi"
    static_dir = package / "config" / "static"
    static_dir.mkdir(parents=True)
    (static_dir / "info.template.yaml").write_text(
        'branding:\n  name: 模板工作台\norganization:\n  name: "{{PRODUCT_NAME}}"\n'
        'footer:\n  copyright: "© {{PRODUCT_NAME}}"\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(branding_service, "__file__", str(package / "services" / "branding_service.py"))
    monkeypatch.setenv("YUXI_BRAND_FILE_PATH", str(tmp_path / "missing.yaml"))
    monkeypatch.chdir(tmp_path)

    result = await load_info_config()

    assert result["branding"]["name"] == "模板工作台"
    assert result["organization"]["name"] == "模板工作台"
    assert result["footer"]["copyright"] == "© 模板工作台"


async def test_explicit_organization_and_copyright_remain_independent(tmp_path, monkeypatch):
    brand_file = tmp_path / "brand.yaml"
    brand_file.write_text(
        'branding:\n  name: 团队工作台\norganization:\n  name: Example Org\nfooter:\n  copyright: © Example Org\n',
        encoding="utf-8",
    )
    monkeypatch.setenv("YUXI_BRAND_FILE_PATH", str(brand_file))

    result = await load_info_config()

    assert result["organization"]["name"] == "Example Org"
    assert result["footer"]["copyright"] == "© Example Org"


@pytest.mark.parametrize("content", ["[]", "branding: {}", "branding: {name: '   '}", "branding: {name: 123}"])
async def test_invalid_product_name_fails_explicitly(tmp_path, monkeypatch, content):
    brand_file = tmp_path / "brand.yaml"
    brand_file.write_text(content, encoding="utf-8")
    monkeypatch.setenv("YUXI_BRAND_FILE_PATH", str(brand_file))

    with pytest.raises(ValueError, match="branding.name"):
        await load_info_config()
