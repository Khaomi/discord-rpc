import { Client } from "@xhayper/discord-rpc";

const client = new Client({
    clientId: "123456789012345678"
});

let lastActivity = {
    state: "Suffering with my life",
    details: "Pain and Suffering",
    startTimestamp: Date.now(),
    largeImageKey: "main",
    largeImageText: "me irl"
};

const setActivity = async (activity) => {
    lastActivity = activity;
    await client.user?.setActivity(activity).then(() => {
        lastActivity = undefined;
    });
}

client.on("ready", async () => {
    if (lastActivity)
        await setActivity(lastActivity);
});

client.on("disconnected", async () => {
    const interval = setInterval(async () => {
        if (client.isConnected)
            clearInterval(interval);

        await client.connect();
    }, 5_000);
})

client.login();
