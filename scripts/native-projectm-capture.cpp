#define GL_SILENCE_DEPRECATION

#include <SDL.h>
#include <OpenGL/gl3.h>
#include <libprojectM/projectM.hpp>

#include "reference-audio-signal.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace {

using stims_reference_audio::kSampleRate;
using stims_reference_audio::kSamplesPerFrame;

// The signal itself lives in reference-audio-signal.h, generated from
// src/js/core/testing/reference-audio.ts so the samples projectM hears and the
// samples the Stims runtime hears cannot drift apart.
//
// Three steady tones, one per band of projectM's own FFT split (BeatDetect.cpp
// ranges1024: bass below 215Hz, mid to 1981Hz, treb above). The amplitudes are
// unequal because projectM weights the bands unequally -- 100/5, 100/41 and
// 90/354 -- and they are chosen so all three land on the same instant energy.
// That makes the steady state analytically exact: bass_history converges to
// bass_instant and vol_history with it, so `bass = E / (1.3E + 0.2E)` = 2/3 on
// every band, and bass_att/mid_att/treb_att/vol converge there too. The other
// side can therefore match without reading projectM's private BeatDetect.
double toneSample(long long sampleIndex) {
  return stims_reference_audio::sampleAt(sampleIndex);
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 8 && argc != 9) {
    std::cerr << "usage: native-projectm-capture <preset-dir> <preset-id> "
                 "<output.ppm> <width> <height> <fps> <frames> [audio]\n"
                 "  audio: silence (default) | tones\n";
    return 2;
  }

  const std::string presetDirectory = argv[1];
  const std::string presetId = argv[2];
  const std::string outputPath = argv[3];
  const int width = std::stoi(argv[4]);
  const int height = std::stoi(argv[5]);
  const int fps = std::stoi(argv[6]);
  const int frameCount = std::stoi(argv[7]);
  const std::string audioMode = argc == 9 ? argv[8] : "silence";
  if (audioMode != "silence" && audioMode != "tones") {
    std::cerr << "unknown audio mode: " << audioMode << "\n";
    return 2;
  }

  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_TIMER) != 0) {
    std::cerr << "SDL init failed: " << SDL_GetError() << "\n";
    return 1;
  }
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 2);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
  SDL_Window* window = SDL_CreateWindow(
      "projectM native reference", 0, 0, width, height,
      SDL_WINDOW_OPENGL | SDL_WINDOW_HIDDEN);
  if (window == nullptr) {
    std::cerr << "SDL window creation failed: " << SDL_GetError() << "\n";
    SDL_Quit();
    return 1;
  }
  SDL_GLContext context = SDL_GL_CreateContext(window);
  if (context == nullptr) {
    std::cerr << "SDL OpenGL context creation failed: " << SDL_GetError()
              << "\n";
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 1;
  }
  const auto* glVendor = glGetString(GL_VENDOR);
  const auto* glRenderer = glGetString(GL_RENDERER);
  const auto* glVersion = glGetString(GL_VERSION);
  std::cerr << "PROJECTM_GL_INFO\t"
            << (glVendor == nullptr
                    ? "unknown"
                    : reinterpret_cast<const char*>(glVendor))
            << "\t"
            << (glRenderer == nullptr
                    ? "unknown"
                    : reinterpret_cast<const char*>(glRenderer))
            << "\t"
            << (glVersion == nullptr
                    ? "unknown"
                    : reinterpret_cast<const char*>(glVersion))
            << "\n";

  projectM::Settings settings;
  settings.meshX = 128;
  settings.meshY = std::max(1, (128 * height) / width);
  settings.fps = fps;
  settings.textureSize = 1024;
  settings.windowWidth = width;
  settings.windowHeight = height;
  settings.presetURL = presetDirectory;
  settings.presetDuration = 600;
  settings.smoothPresetDuration = 0;
  settings.hardcutEnabled = false;
  settings.shuffleEnabled = false;

  {
    projectM app(settings);
    app.setPresetLock(true);
    unsigned int selected = app.getPlaylistSize();
    for (unsigned int i = 0; i < app.getPlaylistSize(); ++i) {
      if (app.getPresetURL(i).find(presetId) != std::string::npos) {
        selected = i;
        break;
      }
    }
    if (selected == app.getPlaylistSize()) {
      std::cerr << "Preset not found in isolated fixture directory: "
                << presetId << "\n";
      return 1;
    }
    app.selectPreset(selected, true);
    if (app.getErrorLoadingCurrentPreset()) {
      std::cerr << "projectM failed to load " << app.getPresetURL(selected)
                << "\n";
      return 1;
    }

    // Silence is not a neutral input, it is an input that makes every
    // audio-reactive preset render nothing: projectM's beat detector divides
    // by fmax(0.0001, ...), so an all-zero buffer gives bass = mid = treb = 0
    // and the reference frame carries no signal to compare against. Four of
    // the nine certified references were captured this way and a solid-black
    // frame passes them.
    std::vector<float> samples(kSamplesPerFrame * 2, 0.0f);
    long long sampleIndex = 0;
    for (int frame = 0; frame < frameCount; ++frame) {
      if (audioMode != "silence") {
        for (int i = 0; i < kSamplesPerFrame; ++i) {
          const float value = static_cast<float>(toneSample(sampleIndex + i));
          samples[i * 2] = value;
          samples[i * 2 + 1] = value;
        }
        sampleIndex += kSamplesPerFrame;
      }
      app.pcm()->addPCMfloat_2ch(samples.data(), kSamplesPerFrame);
      app.renderFrame();
    }

    std::vector<std::uint8_t> pixels(width * height * 3);
    while (glGetError() != GL_NO_ERROR) {
    }
    glFinish();
    glReadBuffer(GL_BACK);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(0, 0, width, height, GL_RGB, GL_UNSIGNED_BYTE,
                 pixels.data());
    const GLenum readError = glGetError();
    if (readError != GL_NO_ERROR) {
      std::cerr << "OpenGL framebuffer read failed: " << readError << "\n";
      return 1;
    }

    std::ofstream output(outputPath, std::ios::binary);
    output << "P6\n" << width << " " << height << "\n255\n";
    const std::size_t rowBytes = static_cast<std::size_t>(width) * 3;
    for (int y = height - 1; y >= 0; --y) {
      output.write(reinterpret_cast<const char*>(pixels.data() + y * rowBytes),
                   rowBytes);
    }
    output.close();

    std::cerr << "Captured native projectM preset "
              << app.getPresetURL(selected) << " at " << width << "x" << height
              << " after " << frameCount << " frames.\n";
    std::cerr << "PROJECTM_TEARDOWN\tprojectM-begin\n";
  }
  std::cerr << "PROJECTM_TEARDOWN\tprojectM-complete\n";

  SDL_GL_DeleteContext(context);
  std::cerr << "PROJECTM_TEARDOWN\tcontext-complete\n";
  // SDL2-compat on macOS intermittently crashes while releasing a successful
  // hidden OpenGL capture, both in SDL_DestroyWindow and SDL_Quit. This is an
  // isolated one-shot subprocess, so let the OS reclaim the remaining hidden
  // window and bypass SDL's registered process-exit teardown after projectM
  // and the GL context have already been released.
  std::cerr << "PROJECTM_TEARDOWN\tprocess-exit\n";
  std::cerr.flush();
  std::_Exit(0);
}
