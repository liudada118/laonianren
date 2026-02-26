from pathlib import Path
import base64

try:
    from playwright.async_api import async_playwright
except Exception:
    async_playwright = None

PAGE_URL = "https://sensor.bodyta.com/4096pdf/"


async def generate_heatmap_png(peak_arr, png_save_path: str) -> str:
    """Render a 4096-length frame into PNG and return saved path."""
    if len(peak_arr) != 4096:
        raise ValueError("peak_arr must contain exactly 4096 values")
    if async_playwright is None:
        raise RuntimeError("playwright is not installed")

    out = Path(png_save_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        await page.goto(PAGE_URL, wait_until="domcontentloaded")
        await page.wait_for_function("() => typeof window.bthClickHandle === 'function'")
        await page.wait_for_selector("#heatmapcanvas", state="attached")
        await page.evaluate("v => window.maxNum = v", 0.6)
        await page.evaluate("v => window.sizeNum = v", 14)
        await page.evaluate("(arr) => window.bthClickHandle(arr)", peak_arr)
        await page.wait_for_timeout(600)
        png_b64 = await page.evaluate(
            "() => document.getElementById('heatmapcanvas').toDataURL('image/png').split(',')[1]"
        )
        out.write_bytes(base64.b64decode(png_b64))
        await browser.close()
    return str(out)