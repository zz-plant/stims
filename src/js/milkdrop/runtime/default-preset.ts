export const DEFAULT_MILKDROP_PRESET_SOURCE = `title=Signal Bloom
author=Stims
description=Curated fallback preset used before the bundled catalog loads.

fRating=4
blend_duration=2.5
fDecay=0.93
zoom=1.02
rot=0.01
warp=0.14
wave_mode=0
wave_scale=1.08
wave_smoothing=0.72
wave_a=0.88
wave_r=0.35
wave_g=0.72
wave_b=1
wave_x=0.5
wave_y=0.52
wave_mystery=0.24
mesh_density=18
mesh_alpha=0.18
mesh_r=0.28
mesh_g=0.52
mesh_b=0.94
bg_r=0.02
bg_g=0.03
bg_b=0.06
bBrighten=1
video_echo_enabled=1
video_echo_alpha=0.18
video_echo_zoom=1.03
ob_size=0.02
ob_r=0.9
ob_g=0.95
ob_b=1
ob_a=0.76
shapecode_0_enabled=1
shapecode_0_sides=6
shapecode_0_x=0.5
shapecode_0_y=0.5
shapecode_0_rad=0.17
shapecode_0_ang=0
shapecode_0_a=0.18
shapecode_0_r=1
shapecode_0_g=0.48
shapecode_0_b=0.84
shapecode_0_border_a=0.9
shapecode_0_border_r=1
shapecode_0_border_g=0.78
shapecode_0_border_b=1
shapecode_0_additive=1
shapecode_0_thickoutline=1
wavecode_0_enabled=1
wavecode_0_samples=72
wavecode_0_spectrum=1
wavecode_0_additive=1
wavecode_0_r=0.92
wavecode_0_g=0.6
wavecode_0_b=1
wavecode_0_a=0.42

per_frame_1=zoom = 1.0 + bass_att * 0.08
per_frame_2=rot = rot + beat_pulse * 0.004
per_frame_3=wave_y = 0.5 + sin(time * 0.35) * 0.08
per_frame_4=shape_1_ang = shape_1_ang + 0.01 + treb_att * 0.01
per_frame_5=ob_size = 0.01 + beat_pulse * 0.02

per_pixel_1=warp = warp + sin(rad * 10 + time * 0.8) * 0.03
wave_0_per_frame1=a = 0.18 + bass_att * 0.36
wave_0_per_point1=y = y + sin(sample * pi * 12 + time) * 0.06
shape_0_per_frame1=rad = 0.14 + beat_pulse * 0.08
`;
