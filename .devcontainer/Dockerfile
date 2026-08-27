# Debian, not Fedora, and on purpose.
#
# The host this is developed on is Fedora and CI is Ubuntu. The one thing that
# has to work inside the container is `playwright install --with-deps`, which
# shells out to apt-get — so matching the runner's package manager means
# Playwright maintains the list of libraries Chromium needs, and matching the
# host's would mean maintaining a dnf list by hand and watching it drift.
#
# Nothing else in this image cares which distribution it is. Every version the
# project pins comes from mise.toml.
FROM mcr.microsoft.com/devcontainers/base:debian-13

USER vscode

# mise, and nothing else. The image is somewhere for mise to run; mise.toml
# decides what is actually in it.
RUN curl -fsSL https://mise.run | sh \
    && echo 'eval "$(mise activate bash)"' >> /home/vscode/.bashrc

# Shims rather than activation. postCreateCommand and `devcontainer exec` run a
# non-login, non-interactive shell that never sources .bashrc, so `just` and
# `node` have to resolve without it.
ENV PATH="/home/vscode/.local/share/mise/shims:/home/vscode/.local/bin:${PATH}"
