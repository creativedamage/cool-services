import threading
import time
import logging


import config
import tornado_server
import shure
import discover


def main():
    config.config()

    time.sleep(.1)
    threads = [
        threading.Thread(target=shure.WirelessQueryQueue, name='rxquery', daemon=True),
        threading.Thread(target=shure.SocketService, name='rxcom', daemon=True),
        threading.Thread(target=tornado_server.twisted, name='web', daemon=True),
        threading.Thread(target=discover.discover, name='discover', daemon=True),
        threading.Thread(target=shure.ProcessRXMessageQueue, name='rxparse', daemon=True),
    ]

    for t in threads:
        t.start()

    # Worker threads are daemons so Ctrl+C / SIGTERM actually stops the server.
    web_thread = threads[2]
    try:
        while True:
            time.sleep(1)
            if not web_thread.is_alive():
                # e.g. port already in use - don't keep running headless
                logging.critical('Web server thread exited; shutting down')
                raise SystemExit(1)
    except KeyboardInterrupt:
        logging.info('Shutting down micboard')
        for rx in shure.NetworkDevices:
            if rx.rx_com_status == 'CONNECTED':
                rx.disable_metering()
        time.sleep(.5)


if __name__ == '__main__':
    main()
