import { io } from "socket.io-client";

export {
  onInitialize,
  onUpdateEntry,
}

async function onInitialize(config, runApi) {
  const socket = io("ws://" + config.serverUrl);
  socket.on("connect", () => {
    console.log("Connected to server");
  });
}


async function onUpdateEntry(config, runApi, id, data) {
  console.log("onUpdateEntry");
}
