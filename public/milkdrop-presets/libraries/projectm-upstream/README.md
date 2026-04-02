# Vendored projectM preset fixtures

These `.milk` files are unmodified copies of a broader, curated slice of the
upstream `projectM` regression preset corpus.

- Upstream repo: `https://github.com/projectM-visualizer/projectm`
- Upstream source tree: `presets/tests/`
- Upstream commit: `36490443622c7cd671e41e512568a845add3a392`
- Retrieved for Stims: `2026-03-21`
- Purpose in Stims: parser/compiler/VM compatibility coverage against real
  upstream `projectM` regression fixtures, including legacy aliases, custom
  wave slots, shader-text/post-processing paths, and equation normalization
  edge cases
- Upstream license context: projectM ships `COPYING` and `LICENSE.txt` under
  the GNU LGPL 2.1-or-later terms
- Coverage note: the upstream regression corpus at this commit does not include
  any presets that exercise custom shape slots; Stims closes that gap with the
  dedicated local corpus under `tests/fixtures/milkdrop/local-shape-corpus/`,
  where shape-heavy fixtures cover shape scalar fields, init/per-frame programs,
  legacy slot spellings, and border/thick/additive metadata while this folder
  remains the vendored upstream wave/shader-oriented suite.

Selected fixture files and hashes:

- `000-empty.milk` -> `presets/tests/000-empty.milk`
  sha256 `79f6a03143e38ec0a06c1f697b4216758afd7c31aff83bbb2519909e254a7ae1`
- `001-line.milk` -> `presets/tests/001-line.milk`
  sha256 `0927cdb46b69bfe19d73da3a58fe953c6fbfd9f9dce6353b93b108939d3fc741`
- `100-square.milk` -> `presets/tests/100-square.milk`
  sha256 `a22cfaf02fc47872b8a714696b38b2bf5a05f92b37dd663b783f9746e30a996f`
- `101-per_frame.milk` -> `presets/tests/101-per_frame.milk`
  sha256 `c67614510e18383559ad2ac2a76362ca241a07b865f3ad59731736ae3f7d6ea7`
- `102-per_frame3.milk` -> `presets/tests/102-per_frame3.milk`
  sha256 `32cd13736c991be3508ddbadf1d8e615543b4e3f23c9f527b30102c8320ec365`
- `103-multiple-eqn.milk` -> `presets/tests/103-multiple-eqn.milk`
  sha256 `ecf25553c16c648d3b900a297b776045c83da5a0bed5bc9609aab793f2e245eb`
- `104-continued-eqn.milk` -> `presets/tests/104-continued-eqn.milk`
  sha256 `9dee9039abf889f4ea9c3ddf0014f92d8b76831da763763d4e05827ced334e0b`
- `105-per_frame_init.milk` -> `presets/tests/105-per_frame_init.milk`
  sha256 `435f2424ccd8ca3614a348c2ec76c1e4bea65c0a32bae90bc8889d702d106a5b`
- `110-per_pixel.milk` -> `presets/tests/110-per_pixel.milk`
  sha256 `8d58b7fcc30241a8dfcd805ee8499863f2efcd70cd862d39d05275bdbec5799f`
- `200-wave.milk` -> `presets/tests/200-wave.milk`
  sha256 `afa1f7df14ef80ea6dd90f22b277e5edcaa62784b22ea913e8664dffe4d95cf5`
- `201-wave.milk` -> `presets/tests/201-wave.milk`
  sha256 `821cfc6f502ffffd2b48959dc1df558c2b32676222bc60065b28de9fb265df66`
- `202-wave.milk` -> `presets/tests/202-wave.milk`
  sha256 `5d962c4b49dedfe49b5f610329a767f8bc9598122b6d921c26c43b9bc1f12c9e`
- `203-wave.milk` -> `presets/tests/203-wave.milk`
  sha256 `d0a2df0eb65022fe722217d06bfe6dbad0102d2084618c4d4b7e3d819d5d637b`
- `204-wave.milk` -> `presets/tests/204-wave.milk`
  sha256 `e4125fec139966e2f96ec36a29fbce335f07e90bd8e958e47e00b750210cb533`
- `205-wave.milk` -> `presets/tests/205-wave.milk`
  sha256 `fc3159f8d7413d8d50772619af53ece96d2e8404d59f7cddc8169b2cba741697`
- `206-wave.milk` -> `presets/tests/206-wave.milk`
  sha256 `dd77dd517d4a94346a1560002edb184bc8c88f715049de0d3b2ef1e34f22a868`
- `207-wave.milk` -> `presets/tests/207-wave.milk`
  sha256 `e361f753c8f2aa11db85f4a475ef355e5899cbb633862fc6e9ee0bfdb36f8f55`
- `208-wave.milk` -> `presets/tests/208-wave.milk`
  sha256 `d471fa8f6b51c8f0566d0d26a3e9423c1b1f68f7414090a47eef80f4d32f4a11`
- `209-wave.milk` -> `presets/tests/209-wave.milk`
  sha256 `6e15e930d2fe235c47f57cfd79d7f8f56cd8cdc161a92807e08bb8e027a32780`
- `210-wave.milk` -> `presets/tests/210-wave.milk`
  sha256 `958b37fa3bb7f16a3404f8c0ce0d1bcc69f435f02506a6c5a63843c7519cf90a`
- `211-wave.milk` -> `presets/tests/211-wave.milk`
  sha256 `e096daeefaa5cbdb041dc92b5c8a89c722ee5ab813bddcbfb33245b0e56208f3`
- `212-wave.milk` -> `presets/tests/212-wave.milk`
  sha256 `8f401c45477fa8f5ddbba3e44697bb7652bd983fe9b4055aa377efd3d7f06baa`
- `213-wave.milk` -> `presets/tests/213-wave.milk`
  sha256 `ae8403decff761b437a50c8fa20f4e2a8515378356e669c249b11bbd9cbc6429`
- `214-wave.milk` -> `presets/tests/214-wave.milk`
  sha256 `a434865f550e62e8c10c9b5654dcada0a0e236edd86ddcca6cb2c9575579b4fd`
- `215-wave.milk` -> `presets/tests/215-wave.milk`
  sha256 `7eaec45d637b297aa9018cd38afca29e0f4a1c094669864c667e7c8ec666d73d`
- `240-wave-smooth-00.milk` -> `presets/tests/240-wave-smooth-00.milk`
  sha256 `02a6e72ae58edc6187ba1d348aec3ecce67b23a39d14980f0a7b116e9a664dbe`
- `241-wave-smooth-01.milk` -> `presets/tests/241-wave-smooth-01.milk`
  sha256 `9cfe286d3f3fe9e3ecd8a926dae00c65509012fc7e3f7d8bdadabf38ced0dce0`
- `242-wave-smooth-80.milk` -> `presets/tests/242-wave-smooth-80.milk`
  sha256 `a7dca4b82fddd94e044a10b75dbd9e8213da470db8456590147f7daed29505ea`
- `243-wave-smooth-90.milk` -> `presets/tests/243-wave-smooth-90.milk`
  sha256 `2010f298a844da3e5b6091eafae67b6d253dcf09a665f9d6ab2e31d9918ce1bc`
- `244-wave-smooth-99.milk` -> `presets/tests/244-wave-smooth-99.milk`
  sha256 `2be06049b53ca4c50d9a6cf17971ce82cb31575f3944f1ce7a473ac69fa7527c`
- `245-wave-smooth-100.milk` -> `presets/tests/245-wave-smooth-100.milk`
  sha256 `fd74e76671ca42aacf265c45af199776bd8f08c6228a27cdb5cf1fccda373a30`
- `250-wavecode.milk` -> `presets/tests/250-wavecode.milk`
  sha256 `501548257965af34322931fd7648f96e7264b8f5a04fea9337acee241ecea2a4`
- `251-wavecode-spectrum.milk` -> `presets/tests/251-wavecode-spectrum.milk`
  sha256 `9a13747c1a22d85c02abb032ff8e1b55995dbce688c81b99148003ea6606e9b2`
- `252-wavecode-spectrum2.milk` -> `presets/tests/252-wavecode-spectrum2.milk`
  sha256 `5cce7d7ba85bdead24373e7c92aa47017e265d18d99433ff2c7628b997c1ac80`
- `260-compshader-noise_lq.milk` -> `presets/tests/260-compshader-noise_lq.milk`
  sha256 `447102d59d0480373adfffec2a277765d1a072ed36dce210f5ac9070d41c43cc`
- `261-compshader-noisevol_lq.milk` -> `presets/tests/261-compshader-noisevol_lq.milk`
  sha256 `628d622e463cf14db3be48f9c2635b812438dd348a50250db93039ac6e00fe47`
- `300-beatdetect-bassmidtreb.milk` -> `presets/tests/300-beatdetect-bassmidtreb.milk`
  sha256 `b5d7bf8e812a50b568b8427fd93f7faba6a4f0d64463ab71c9482af38aa0ec65`
