# Desktop installation and updates

[Back to the README](../README.md)

Download an installer from the [latest snapshot release](https://github.com/licentiapoetica/mumh5/releases/tag/snapshot). These are rolling prerelease builds from `main`. The release includes `SHA256SUMS` for checking downloads.

## AppImage troubleshooting

Older builds use an AppImage runtime that requires the system's FUSE 2 library. Current builds bundle a static FUSE runtime instead. If an older AppImage stops with `dlopen(): error loading libfuse.so.2`, download a new build, or run it without FUSE by extracting it at launch:

```bash
./mumh5-linux-x64.AppImage --appimage-extract-and-run
```

This extracts to a temporary folder on each launch. For regular use without FUSE, choose the `.deb` or `.tar.gz` instead. See the [AppImage FUSE troubleshooting guide](https://docs.appimage.org/user-guide/troubleshooting/fuse.html) for installation instructions for your distribution.

An AppImage runs from a temporary folder with a new name on each start, so firewalls that allow programs by their path (OpenSnitch, for example) ask again after every restart. The `.tar.gz` install below has a fixed path.

## Portable installation

The `.tar.gz` comes with an installer and an uninstaller. Unpack it and run the installer from that folder; it adds the app, a `mumh5` command and a menu entry, and running it again with a newer version updates it:

```bash
tar xzf mumh5-linux-x64.tar.gz
cd mumh5-<version>-linux-x64
./install.sh                 # for you only, in ~/.local
sudo ./install.sh --system   # or for everyone, in /opt
```

## Install or update the latest snapshot

To download, install and later update the latest build in one step, for you only, use [`scripts/install-snapshot.sh`](../scripts/install-snapshot.sh). It runs the same installer, and running it again updates when a newer build is out (`--wait` keeps checking until there is one):

```bash
curl -fsSL https://raw.githubusercontent.com/licentiapoetica/mumh5/main/scripts/install-snapshot.sh | bash
```

## Uninstall

To remove it, run `~/.local/share/mumh5/uninstall.sh` (or `sudo /opt/mumh5/uninstall.sh`). Your settings and identities stay in `~/.config/mumh5`; `uninstall.sh --purge` deletes them too, after asking. Back up your identity first. The Windows installer has its own uninstaller in the system settings; the `.deb` is removed with `sudo apt remove mumh5`.

## macOS

Automated macOS builds are disabled. To use mumh5 on macOS, build it on a Mac from the source.
