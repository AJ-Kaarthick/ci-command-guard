import os
from PIL import Image, ImageDraw, ImageFont

FONT_TITLE = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", 20)
FONT_HEADING = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", 16)
FONT_TEXT = ImageFont.truetype("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", 14)
FONT_TEXT_SM = ImageFont.truetype("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", 12)
FONT_MONO = ImageFont.truetype("/usr/share/fonts/truetype/noto/NotoMono-Regular.ttf", 13)
FONT_MONO_SM = ImageFont.truetype("/usr/share/fonts/truetype/noto/NotoMono-Regular.ttf", 11)

def generate_overview(output_path):
    w, h = 880, 360
    img = Image.new("RGBA", (w, h), (15, 23, 42, 255)) # slate-900
    draw = ImageDraw.Draw(img)

    # Outer border
    draw.rounded_rectangle([(8, 8), (w - 8, h - 8)], radius=12, outline=(51, 65, 85, 255), width=2)

    # Header
    draw.text((32, 24), "CI Command Guard: Catch CI Failures Before You Push", fill=(248, 250, 252, 255), font=FONT_TITLE)
    draw.text((32, 52), "Deterministic local reference validation vs. remote CI trial-and-error", fill=(148, 163, 184, 255), font=FONT_TEXT)

    card_w = 396
    card_h = 240
    y_card = 90

    # Left Card: Traditional CI Experience (Failure cycle)
    x_left = 32
    draw.rounded_rectangle([(x_left, y_card), (x_left + card_w, y_card + card_h)], radius=8, fill=(30, 41, 59, 255), outline=(239, 68, 68, 180), width=1)
    # Badge
    draw.rounded_rectangle([(x_left + 16, y_card + 14), (x_left + 160, y_card + 36)], radius=4, fill=(127, 29, 29, 255))
    draw.text((x_left + 24, y_card + 16), "Without Extension", fill=(254, 202, 202, 255), font=FONT_TEXT_SM)

    steps_left = [
        ("1. Typo in workflow YAML", "run: npm run buid", (248, 113, 113, 255)),
        ("2. Developer pushes commit", "git push origin main", (203, 213, 225, 255)),
        ("3. Wait 3-5m for CI runner", "GitHub Actions queue & boot", (148, 163, 184, 255)),
        ("4. CI fails on missing script", "npm ERR! missing script: buid", (239, 68, 68, 255)),
    ]
    cur_y = y_card + 48
    for title, sub, col in steps_left:
        draw.text((x_left + 18, cur_y), title, fill=(226, 232, 240, 255), font=FONT_TEXT_SM)
        draw.text((x_left + 18, cur_y + 18), sub, fill=col, font=FONT_MONO_SM)
        cur_y += 44

    # Right Card: With CI Command Guard (Instant local feedback)
    x_right = 452
    draw.rounded_rectangle([(x_right, y_card), (x_right + card_w, y_card + card_h)], radius=8, fill=(30, 41, 59, 255), outline=(16, 185, 129, 180), width=1)
    # Badge
    draw.rounded_rectangle([(x_right + 16, y_card + 14), (x_right + 185, y_card + 36)], radius=4, fill=(6, 78, 59, 255))
    draw.text((x_right + 24, y_card + 16), "With CI Command Guard", fill=(167, 243, 208, 255), font=FONT_TEXT_SM)

    steps_right = [
        ("1. Instant local detection in editor", "Problems squiggles on 'buid'", (56, 189, 248, 255)),
        ("2. Rich explanation & typo match", "package.json checked; 'build' suggested", (167, 243, 208, 255)),
        ("3. Press Ctrl+. for 1-click fix", "Fix this reference -> 'build'", (52, 211, 153, 255)),
        ("4. Clean commit pushed to CI", "First-time pass with 0 CI delays", (16, 185, 129, 255)),
    ]
    cur_y = y_card + 48
    for title, sub, col in steps_right:
        draw.text((x_right + 18, cur_y), title, fill=(226, 232, 240, 255), font=FONT_TEXT_SM)
        draw.text((x_right + 18, cur_y + 18), sub, fill=col, font=FONT_MONO_SM)
        cur_y += 44

    img.save(output_path, "PNG", optimize=True)
    print(f"Created {output_path}")

def generate_quick_fix_preview(output_path):
    w, h = 880, 360
    img = Image.new("RGBA", (w, h), (15, 23, 42, 255))
    draw = ImageDraw.Draw(img)

    draw.rounded_rectangle([(8, 8), (w - 8, h - 8)], radius=12, outline=(51, 65, 85, 255), width=2)

    # Window bar
    draw.rounded_rectangle([(8, 8), (w - 8, 44)], radius=8, fill=(30, 41, 59, 255))
    draw.ellipse([(20, 20), (30, 30)], fill=(239, 68, 68, 255))
    draw.ellipse([(36, 20), (46, 30)], fill=(245, 158, 11, 255))
    draw.ellipse([(52, 20), (62, 30)], fill=(16, 185, 129, 255))
    draw.text((76, 16), ".github/workflows/ci.yml - CI Command Guard (Ctrl+.)", fill=(203, 213, 225, 255), font=FONT_TEXT_SM)

    # Editor text
    code_lines = [
        " 8 |     steps:",
        " 9 |       - uses: actions/checkout@v4",
        "10 |       - name: Run build",
        "11 |         run: npm run buid",
        "12 |       - name: Verify build artifact",
        "13 |         run: node scripts/Build.js"
    ]
    y_code = 58
    for line in code_lines:
        draw.text((24, y_code), line, fill=(203, 213, 225, 255), font=FONT_MONO)
        y_code += 24

    # Squiggle under 'buid' on line 11 (run: npm run buid)
    # Position of 'buid':
    # x offset for '11 |         run: npm run ': ~210 px
    x_sq = 216
    y_sq = 58 + 24 * 3 + 17
    # Draw wavy red line
    draw.line([(x_sq, y_sq), (x_sq + 34, y_sq)], fill=(239, 68, 68, 255), width=2)

    # Squiggle under 'scripts/Build.js' on line 13
    x_sq2 = 216
    y_sq2 = 58 + 24 * 5 + 17
    draw.line([(x_sq2, y_sq2), (x_sq2 + 130, y_sq2)], fill=(239, 68, 68, 255), width=2)

    # Hover Tooltip Box
    tt_x, tt_y = 210, 165
    tt_w, tt_h = 630, 85
    draw.rounded_rectangle([(tt_x, tt_y), (tt_x + tt_w, tt_y + tt_h)], radius=6, fill=(24, 33, 47, 255), outline=(56, 189, 248, 200), width=1)
    draw.text((tt_x + 12, tt_y + 8), "Broken package script reference: 'buid'", fill=(248, 113, 113, 255), font=FONT_HEADING)
    draw.text((tt_x + 12, tt_y + 30), "• Looked in: package.json (at ./package.json)", fill=(203, 213, 225, 255), font=FONT_TEXT_SM)
    draw.text((tt_x + 12, tt_y + 46), "• Reason: Script 'buid' is not declared in package.json scripts", fill=(203, 213, 225, 255), font=FONT_TEXT_SM)
    draw.text((tt_x + 12, tt_y + 64), "• Suggested fix: Replace with 'build'", fill=(52, 211, 153, 255), font=FONT_HEADING)

    # Quick Fix Popup (Ctrl+.)
    qf_x, qf_y = 210, 260
    qf_w, qf_h = 630, 82
    draw.rounded_rectangle([(qf_x, qf_y), (qf_x + qf_w, qf_y + qf_h)], radius=6, fill=(30, 41, 59, 255), outline=(71, 85, 105, 255), width=1)

    # Selected item
    draw.rounded_rectangle([(qf_x + 4, qf_y + 4), (qf_x + qf_w - 4, qf_y + 28)], radius=4, fill=(14, 116, 144, 255))
    draw.text((qf_x + 12, qf_y + 8), "Fix this reference: Replace 'buid' with 'build' (Preferred)", fill=(255, 255, 255, 255), font=FONT_TEXT_SM)

    draw.text((qf_x + 12, qf_y + 34), "Fix all safe issues in this workflow (2 fixes)", fill=(203, 213, 225, 255), font=FONT_TEXT_SM)
    draw.text((qf_x + 12, qf_y + 58), "Fix all safe issues in workspace (4 fixes)", fill=(203, 213, 225, 255), font=FONT_TEXT_SM)

    img.save(output_path, "PNG", optimize=True)
    print(f"Created {output_path}")

def generate_bulk_review_preview(output_path):
    w, h = 880, 360
    img = Image.new("RGBA", (w, h), (15, 23, 42, 255))
    draw = ImageDraw.Draw(img)

    draw.rounded_rectangle([(8, 8), (w - 8, h - 8)], radius=12, outline=(51, 65, 85, 255), width=2)

    # Header / Context
    draw.text((32, 22), "Bulk Fix Review Dialog (Native Modal with Single Cancel Button)", fill=(248, 250, 252, 255), font=FONT_TITLE)
    draw.text((32, 48), "Pre-application verification guarantees zero partial or unreviewed edits", fill=(148, 163, 184, 255), font=FONT_TEXT)

    # Modal Box
    m_x, m_y = 100, 80
    m_w, m_h = 680, 250
    draw.rounded_rectangle([(m_x, m_y), (m_x + m_w, m_y + m_h)], radius=10, fill=(30, 41, 59, 255), outline=(56, 189, 248, 255), width=1)

    # Dialog Title
    draw.text((m_x + 24, m_y + 18), "CI Command Guard: Review proposed changes (3 safe fixes in current workflow)", fill=(255, 255, 255, 255), font=FONT_HEADING)

    # Detailed Summary Box
    s_x = m_x + 24
    s_y = m_y + 46
    s_w = m_w - 48
    s_h = 136
    draw.rounded_rectangle([(s_x, s_y), (s_x + s_w, s_y + s_h)], radius=6, fill=(15, 23, 42, 255), outline=(51, 65, 85, 255), width=1)

    changes = [
        ".github/workflows/ci.yml (3 fixes):",
        "  - Line 11: Replace 'buid' with 'build'",
        "  - Line 13: Replace 'scripts/Build.js' with 'scripts/build.js'",
        "  - Line 22: Replace 'tst:unit' with 'test:unit'",
        "",
        "> All document versions and ranges validated. Cancel leaves all files unchanged."
    ]
    cur_y = s_y + 10
    for line in changes:
        color = (52, 211, 153, 255) if line.startswith(">") else (203, 213, 225, 255)
        font = FONT_TEXT_SM if line.startswith(">") else FONT_MONO_SM
        draw.text((s_x + 14, cur_y), line, fill=color, font=font)
        cur_y += 19

    # Buttons: exactly ONE 'Apply Changes' and exactly ONE native 'Cancel'
    # Apply Changes (Primary Cyan/Blue)
    btn1_x = m_x + m_w - 264
    btn1_y = m_y + m_h - 48
    draw.rounded_rectangle([(btn1_x, btn1_y), (btn1_x + 130, btn1_y + 32)], radius=4, fill=(14, 116, 144, 255), outline=(56, 189, 248, 255), width=1)
    draw.text((btn1_x + 16, btn1_y + 7), "Apply Changes", fill=(255, 255, 255, 255), font=FONT_HEADING)

    # Native Cancel (Neutral dark gray)
    btn2_x = m_x + m_w - 118
    btn2_y = m_y + m_h - 48
    draw.rounded_rectangle([(btn2_x, btn2_y), (btn2_x + 94, btn2_y + 32)], radius=4, fill=(51, 65, 85, 255), outline=(100, 116, 139, 255), width=1)
    draw.text((btn2_x + 24, btn2_y + 7), "Cancel", fill=(241, 245, 249, 255), font=FONT_HEADING)

    img.save(output_path, "PNG", optimize=True)
    print(f"Created {output_path}")

if __name__ == "__main__":
    generate_overview("media/overview.png")
    generate_quick_fix_preview("media/quick-fix-preview.png")
    generate_bulk_review_preview("media/bulk-review-preview.png")
