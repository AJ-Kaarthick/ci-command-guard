import os
from PIL import Image, ImageDraw, ImageFont

def create_icon(output_path):
    # Render at 4x (1024x1024) and downscale to 256x256 for ultra-crisp antialiasing
    scale = 4
    size = 256 * scale
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Background rounded rectangle
    # Deep navy / charcoal background
    bg_color = (15, 23, 42, 255) # slate-900 #0F172A
    border_color = (51, 65, 85, 255) # slate-700
    radius = 56 * scale
    margin = 8 * scale

    draw.rounded_rectangle(
        [(margin, margin), (size - margin, size - margin)],
        radius=radius,
        fill=bg_color,
        outline=border_color,
        width=int(3 * scale)
    )

    # 2. Draw subtle glowing inner gradient / decorative ring
    glow_color = (6, 182, 212, 40) # Cyan with low opacity
    draw.rounded_rectangle(
        [(margin + 16 * scale, margin + 16 * scale), (size - margin - 16 * scale, size - margin - 16 * scale)],
        radius=radius - 12 * scale,
        outline=glow_color,
        width=int(2 * scale)
    )

    # 3. Outer Guard Shield silhouette
    cx = size // 2
    # Shield shape points
    top_y = 48 * scale
    shoulder_y = 104 * scale
    bottom_y = 212 * scale
    width_half = 76 * scale

    shield_pts = [
        (cx, top_y),
        (cx + width_half, top_y + 16 * scale),
        (cx + width_half, shoulder_y + 24 * scale),
        (cx, bottom_y),
        (cx - width_half, shoulder_y + 24 * scale),
        (cx - width_half, top_y + 16 * scale),
    ]

    # Draw shield background
    shield_fill = (30, 41, 59, 255) # slate-800
    shield_border = (56, 189, 248, 255) # cyan-400
    draw.polygon(shield_pts, fill=shield_fill, outline=shield_border)

    # 4. CI Workflow Nodes & Pipeline Track inside Shield
    # Branching nodes:
    # Left node (start), Middle node (step), Right-Top (verify), Right-Bottom (pass)
    node_left = (cx - 42 * scale, 120 * scale)
    node_mid = (cx - 8 * scale, 120 * scale)
    node_top = (cx + 34 * scale, 95 * scale)
    node_bot = (cx + 34 * scale, 145 * scale)

    pipeline_line_color = (148, 163, 184, 255) # slate-400
    cyan_line_color = (56, 189, 248, 255) # cyan-400
    green_color = (16, 185, 129, 255) # emerald-500

    line_w = int(6 * scale)

    # Draw pipeline connectors
    draw.line([node_left, node_mid], fill=pipeline_line_color, width=line_w)
    draw.line([node_mid, node_top], fill=cyan_line_color, width=line_w)
    draw.line([node_mid, node_bot], fill=cyan_line_color, width=line_w)

    # Draw nodes
    r_node = 10 * scale
    for pt in [node_left, node_mid, node_top, node_bot]:
        draw.ellipse(
            [(pt[0] - r_node, pt[1] - r_node), (pt[0] + r_node, pt[1] + r_node)],
            fill=(15, 23, 42, 255),
            outline=cyan_line_color,
            width=int(3.5 * scale)
        )

    # 5. Prominent Verified Shield Checkmark (Guard / verification symbol)
    # Vibrant emerald-green checkmark overlaying lower-middle
    check_w = int(10 * scale)
    p1 = (cx - 28 * scale, 138 * scale)
    p2 = (cx - 4 * scale, 164 * scale)
    p3 = (cx + 38 * scale, 108 * scale)

    # Soft dark shadow for contrast
    shadow_offset = 2 * scale
    draw.line([(p1[0], p1[1] + shadow_offset), (p2[0], p2[1] + shadow_offset), (p3[0], p3[1] + shadow_offset)],
              fill=(10, 15, 30, 180), width=check_w, joint="curve")

    # Emerald checkmark
    draw.line([p1, p2, p3], fill=green_color, width=check_w, joint="curve")

    # Downscale with Lanczos
    final_img = img.resize((256, 256), Image.Resampling.LANCZOS)
    final_img.save(output_path, "PNG", optimize=True)
    print(f"Created {output_path} (256x256)")

if __name__ == "__main__":
    create_icon("media/icon.png")
