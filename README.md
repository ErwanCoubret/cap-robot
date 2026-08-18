# CAP ROBOT

## SETUP

From total scratch with a fresh Raspberry Pi OS light installation

### 1. Global updates and dependencies

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install git-all -y
ssh-keygen -t ed25519 -C "your_email@example.com"
cat ~/.ssh/id_ed25519.pub
```

copy the output of the last command and add it to your GitHub account (Settings > SSH and GPG keys > New SSH key)

```
sudo systemctl enable --now ssh
ssh cap@192.168.10.127 # password: cap
```

### 2. Specific dependencies for the project

```bash
sudo apt install python3-pip python3-venv
```

#### Clone the repository

```bash
git clone
```

#### Install ai-camera dependencies

Read the [ai-camera README](./ai-camera/README.md) for instructions on how to set up the camera and load models.

#### Control eyes via serial

Read the [eyes README](./eyes/README.md) for instructions on how to control the eyes via serial protocol.