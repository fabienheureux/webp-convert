import Koa, { Context } from "koa";
import https from "http";
import sharp, { OutputInfo } from "sharp";
import request from "request";
import S3 from "aws-sdk/clients/s3";
import cache from "memory-cache"
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
  console.log("get s3 url, S3 path: ", s3Path, '\n')
  const prefix = `https://d18ayr6nh7939z.cloudfront.net`;
  return `${prefix}/${s3Path}`;
}

function isObjectInS3(s3: any, key: string): Promise<boolean> {
  console.log("isObjectInS3", key)
  return new Promise<boolean>(resolve =>
    s3.getObject(
      {
        Bucket: "wud-staging" || "",
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
  console.log('convert source, that is: ', source, '\n')
  const imageBuffer = await getImageAsBuffer(source);
  return sharp(imageBuffer)
    .webp()
    .toBuffer();
}

function store(s3: any, key: string, source: string): Promise<string> {
  return new Promise<string>(async resolve => s3.putObject(
      {
        Bucket: "wud-staging" || "",
        Key: key,
        ACL: "public-read",
        Body: await convertSourceToWebp(source)
      }, (err: Error) => err ? console.error(err) : resolve(key))
    );
}

app.use(async (ctx: Context, next: Function) => {
  const { referer } = ctx.request.headers
  const { originalUrl } = ctx
  if (cache.get(originalUrl)) {
  	ctx.redirect(cache.get(originalUrl))
  }
  else {
	  // const key = (url.parse(source).path || "").slice(1);
	  const key = originalUrl.slice(1)
	  const ext = path.extname(key);
	  const source = `https://staging.whatsupdoc-lemag.fr${originalUrl}`

	  if (ext !== '.jpg' && ext !== '.png') {
		console.log("don't touch to source")
		console.log(referer, key)
		ctx.redirect(source)
		cache.put(originalUrl, source)
	    } else {
		  const s3 = new S3({
		    credentials: {
		      accessKeyId: process.env.ACCESS_KEY_ID || "", // Trick to avoid type checking
		      secretAccessKey: process.env.SECRET_ACCESS_KEY || "" // Trick to avoid type checking
		    }
		  });
		  console.log(key)

		  /**
		   * Check if there is something at the submitted path
		   */
		  if (await isObjectInS3(s3, key)) {
		    /**
		     * Yep, there is something. 
		     * Let's return it.
		     */
		    console.log("ALREADY IN S3, Let's return \n")
		    cache.put(originalUrl, getS3Url(key))
		  } else {
		    /**
		     * Nope ? well, let's convert the source to webp before 
		     * returning the appropriate file
		     */
		    const webpKey = key.replace(ext, ".webp");
		    console.log("WE CREATED A NEW FILE !")
		    cache.put(originalUrl, getS3Url(await store(s3, webpKey, source)))
		  }
	  }
    ctx.redirect(cache.get(originalUrl));
  }
});

app.listen(3000);
