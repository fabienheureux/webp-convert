import Koa, { Context } from "koa";
import https from "http";
import sharp, { OutputInfo } from "sharp";
import request from "request";
import S3 from "aws-sdk/clients/s3";
import * as url from "url";
import * as path from "path";

const app = new Koa();

function getImageAsBuffer(imageUrl: string) {
  const options = {
    url: imageUrl,
    method: "get",
    encoding: null
  };

  return new Promise<Buffer>(resolve => {
    request(options, function(err, res, body: Buffer) {
      if (!err && res.statusCode == 200) resolve(body);
    });
  });
}

function getS3Url(s3Path: string): string {
 const prefix = `https://${process.env.BUCKET_NAME}.s3.eu-west-3.amazonaws.com`;
  return `${prefix}/${s3Path}`;
}

function isObjectInS3(s3: any, key: string): Promise<boolean> {
  return new Promise<boolean>(resolve =>
    s3.getObject(
      {
        Bucket: process.env.BUCKET_NAME || "",
        Key: key
      },
      (err: Error, data: any) => {
        if (err) {
          resolve(false);
        } else {
          resolve(true);
        }
      }
    )
  );
}

async function convertSourceToWebp(source: string): Promise<Buffer> {
  const imageBuffer = await getImageAsBuffer(source);
  return sharp(imageBuffer)
    .webp()
    .toBuffer();
}

function store(s3: any, key: string, source: string): Promise<string> {
  return new Promise<string>(async resolve => s3.putObject(
      {
        Bucket: process.env.BUCKET_NAME || "",
        Key: key,
        ACL: "public-read",
        Body: await convertSourceToWebp(source)
      }, (err: Error) => !err && resolve(key))
    );
}

app.use(async (ctx: Context, next: Function) => {
  const s3 = new S3({
    credentials: {
      accessKeyId: process.env.ACCESS_KEY_ID || "", // Trick to avoid type checking
      secretAccessKey: process.env.SECRET_ACCESS_KEY || "" // Trick to avoid type checking
    }
  });
  const source = ctx.query.q;
  const key = (url.parse(source).path || "").slice(1);

  /**
   * Check if there is something at the submitted path
   */
  if (await isObjectInS3(s3, key)) {
    /**
     * Yep, there is something. 
     * Let's return it.
     */
    ctx.body = getS3Url(key);
  } else {
    /**
     * Nope ? well, let's convert the source to webp before 
     * returning the appropriate file
     */
    const ext = path.extname(key);
    const webpKey = key.replace(ext, ".webp");
    ctx.body = getS3Url(await store(s3, webpKey, source));
  }
});

app.listen(3000);
