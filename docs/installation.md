# Server Installation
Micboard server can be installed on many different platforms.  For small and portable systems, Micboard can run on a Raspberry Pi hidden in the back of a rack.  Ubuntu Server is recommended for large permanent installations.

The macOS app provides a great way to try Micboard before purchasing additional hardware.

## Debian (Ubuntu & Raspberry Pi)
Install git, python3-pip, and Node.js
```
$ sudo apt-get update
$ sudo apt-get install git python3-venv
$ curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
$ sudo apt-get install nodejs
```

Download micboard
```
$ git clone https://github.com/creativedamage/micboard.git
```

Install micboard software dependencies via npm and pip. Recent Debian, Ubuntu and
Raspberry Pi OS releases block system-wide `pip install`, so use a virtual environment.
```
$ cd micboard/
$ npm install
$ python3 -m venv .venv
$ .venv/bin/pip install -r py/requirements.txt
```

build the micboard frontend and run micboard
```
$ npm run build
$ .venv/bin/python py/micboard.py
```

Edit `User` and `WorkingDirectory` within `micboard.service` to match your installation (the service runs `.venv/bin/python` from the working directory) and install it as a service.
```
$ sudo cp micboard.service /etc/systemd/system/
$ sudo systemctl start micboard.service
$ sudo systemctl enable micboard.service
```

Check the [configuration](configuration.md) docs for more information on configuring micboard.

## macOS - Desktop Application
Download and run micboard from the project's [GitHub Release](https://github.com/karlcswanson/micboard/releases/) page.  Add RF devices to the 'Slot Configuration' and press 'Save'.

Check the [configuration](configuration.md) docs for more information on configuring micboard.


## macOS - From Source
Install the Xcode command-line tools
```
$ xcode-select --install
```

Install the homebrew package manager
```
$ /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Install python3 and node
```
$ brew install python3 node
```

Download Micboard
```
$ git clone https://github.com/creativedamage/micboard.git
```

Install micboard software dependencies via npm and pip
```
$ cd micboard/
$ npm install
$ python3 -m venv .venv
$ .venv/bin/pip install -r py/requirements.txt
```

build the micboard frontend and run micboard
```
$ npm run build
$ .venv/bin/python py/micboard.py
```

Check the [configuration](configuration.md) docs for more information on configuring micboard.

## Docker
Download micboard from github
```
$ git clone https://github.com/creativedamage/micboard.git
```

Build and run the docker image. The compose file uses host networking so that
device discovery (multicast) works; configuration is stored in `./config`.
```
$ cd micboard/
$ docker compose up -d --build
```
