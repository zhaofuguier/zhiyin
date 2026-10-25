from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
FONT_PATH = Path("C:/Windows/Fonts/msyh.ttc")
BACKGROUND = "#10211d"
LABEL = "#f4f8f6"


def font(size: int):
    return ImageFont.truetype(str(FONT_PATH), size) if FONT_PATH.exists() else ImageFont.load_default()


def make_sheet(output: str, items: list[tuple[str, str]], columns: int) -> None:
    cell_width = 300
    image_height = 649
    label_height = 54
    gap = 18
    rows = (len(items) + columns - 1) // columns
    width = gap + columns * (cell_width + gap)
    height = gap + rows * (label_height + image_height + gap)
    sheet = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(sheet)
    label_font = font(24)

    for index, (filename, title) in enumerate(items):
        row, column = divmod(index, columns)
        x = gap + column * (cell_width + gap)
        y = gap + row * (label_height + image_height + gap)
        draw.rounded_rectangle((x, y, x + cell_width, y + label_height + image_height), 18, fill="#f6f8f7")
        draw.text((x + 16, y + 12), title, fill="#153f37", font=label_font)

        source = Image.open(ROOT / filename).convert("RGB")
        source.thumbnail((cell_width, image_height), Image.Resampling.LANCZOS)
        px = x + (cell_width - source.width) // 2
        py = y + label_height + (image_height - source.height) // 2
        sheet.paste(source, (px, py))

    sheet.save(ROOT / output, quality=92, optimize=True)


make_sheet(
    "14-overview.jpg",
    [
        ("01-home.png", "01 首页"),
        ("02-scenes.png", "02 场景"),
        ("03-favorites.png", "03 收藏"),
        ("04-profile.png", "04 我的"),
    ],
    2,
)

make_sheet(
    "15-player-tools.jpg",
    [
        ("05-player.png", "05 播放页"),
        ("06-effects.png", "06 画面效果"),
        ("07-timer.png", "07 定时"),
        ("13-player-missing-audio.png", "13 播放失败"),
    ],
    2,
)

make_sheet(
    "16-blocked-routes.jpg",
    [
        ("08-search.png", "08 搜索"),
        ("09-student.png", "09 学生专注"),
        ("10-member.png", "10 会员"),
        ("11-privacy.png", "11 隐私与账号"),
        ("12-student-settings.png", "12 学生设置"),
    ],
    3,
)
