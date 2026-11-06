# Demo media

| File | Format |
| --- | --- |
| [Video](videos/dashboard-demo-anonymous.mp4) | 27 seconds, 1920 × 1080, 30 fps, H.264, silent |
| [README GIF](images/dashboard-demo-anonymous.gif) | 960 × 540, 12 fps, looping |

The demo uses staged calendar events, official artwork for Cherry Ferrari’s **Night Before - Acoustic**, and a Sydney forecast from Open-Meteo. It was recorded in Playwright and edited in Remotion.

On machines with little free disk space, render short sections in separate browser processes, then concatenate the MP4 segments. The [motion-ui-videos](https://github.com/dauletbekalim/motion-ui-videos) project provides another Remotion workflow.

## Update the GIF

Generate a palette, then convert the video:

```sh
ffmpeg -i docs/videos/dashboard-demo-anonymous.mp4 \
  -vf "fps=12,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff:max_colors=128" \
  -frames:v 1 /tmp/dashboard-demo-palette.png

ffmpeg -i docs/videos/dashboard-demo-anonymous.mp4 -i /tmp/dashboard-demo-palette.png \
  -filter_complex "[0:v]fps=12,scale=960:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  -loop 0 docs/images/dashboard-demo-anonymous.gif
```

Keep the full-resolution MP4 link beside the GIF in the README.
