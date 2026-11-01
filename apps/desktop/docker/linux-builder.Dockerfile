# Linux build environment for the DevHub desktop app.
#
# Ubuntu 22.04, not latest. Tauri links against the system WebKitGTK, which
# links against glibc, and a binary built on a newer glibc will not start on an
# older one. Building on the oldest distribution we support is the only way to
# produce an AppImage that runs everywhere we claim it does.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Tauri's Linux dependencies, plus what the AppImage bundler needs.
# libwebkit2gtk-4.1 is the Tauri 2 requirement (4.0 was Tauri 1).
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      curl \
      file \
      git \
      ca-certificates \
      libwebkit2gtk-4.1-dev \
      libgtk-3-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libssl-dev \
      patchelf \
      pkg-config \
      wget \
      xz-utils \
      desktop-file-utils \
      fuse \
    && rm -rf /var/lib/apt/lists/*

# Node for the staging pipeline. Pinned to the same major the app ships.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Rust + the Tauri CLI. Baked into the image so the build itself is fast.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
RUN cargo install tauri-cli --version "^2" --locked

WORKDIR /work
CMD ["bash"]
