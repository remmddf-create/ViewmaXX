import AWS from 'aws-sdk';

const s3 = new AWS.S3({
  accessKeyId: process.env.STORAGE_KEY,
  secretAccessKey: process.env.STORAGE_SECRET,
  region: process.env.STORAGE_REGION || 'us-east-1',
});

export const uploadToS3 = async (bucket: string, key: string, body: Buffer | string, contentType: string) => {
  const params = {
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  };
  return s3.upload(params).promise();
};

export const getSignedUrl = (bucket: string, key: string, expiresIn = 60 * 5) => {
  return s3.getSignedUrl('getObject', {
    Bucket: bucket,
    Key: key,
    Expires: expiresIn,
  });
};
