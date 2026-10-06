import { getWebServerConfig } from "./config";
import { UpscaylWebServer } from "./server";

const start = async () => {
  const config = getWebServerConfig();
  const application = new UpscaylWebServer(config);
  await application.initialize();
  const server = application.createHttpServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  console.log(
    `Upscayl Web is available at http://${config.host}:${config.port}`,
  );
  console.log(`Data directory: ${config.dataRoot}`);
};

start().catch((error) => {
  console.error("Upscayl Web failed to start:", error);
  process.exitCode = 1;
});
