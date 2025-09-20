import AWS from 'aws-sdk';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

let s3: AWS.S3;

export const initializeS3 = async () => {
  try {
    AWS.config.update({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
    });

    s3 = new AWS.S3({
      apiVersion: '2006-03-01',
      signatureVersion: 'v4',
    });

    // Test connection by listing buckets
    await s3.listBuckets().promise();
    console.log('✅ S3 initialized successfully');

    return s3;
  } catch (error) {
    console.error('❌ Failed to initialize S3:', error);
    throw error;
  }
};

export { s3 };

// Upload file to S3
export const uploadToS3 = async (
  filePath: string,
  key: string,
  contentType: string,
  bucket: string = process.env.S3_BUCKET!
): Promise<AWS.S3.ManagedUpload.SendData> => {
  try {
    const fileContent = fs.readFileSync(filePath);
    
    const params: AWS.S3.PutObjectRequest = {
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: contentType,
      ACL: 'public-read',
    };

    const result = await s3.upload(params).promise();
    
    // Clean up temporary file
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.warn('Failed to clean up temporary file:', filePath);
    }

    return result;
  } catch (error) {
    console.error('S3 upload error:', error);
    throw error;
  }
};

// Generate presigned URL for direct upload
export const generatePresignedUrl = async (
  key: string,
  contentType: string,
  expiresIn: number = 3600, // 1 hour
  bucket: string = process.env.S3_BUCKET!
): Promise<string> => {
  try {
    const params = {
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      Expires: expiresIn,
      ACL: 'public-read',
    };

    return s3.getSignedUrl('putObject', params);
  } catch (error) {
    console.error('Presigned URL generation error:', error);
    throw error;
  }
};

// Generate presigned URL for download
export const generateDownloadUrl = async (
  key: string,
  expiresIn: number = 3600,
  bucket: string = process.env.S3_BUCKET!
): Promise<string> => {
  try {
    const params = {
      Bucket: bucket,
      Key: key,
      Expires: expiresIn,
    };

    return s3.getSignedUrl('getObject', params);
  } catch (error) {
    console.error('Download URL generation error:', error);
    throw error;
  }
};

// Delete file from S3
export const deleteFromS3 = async (
  key: string,
  bucket: string = process.env.S3_BUCKET!
): Promise<void> => {
  try {
    const params = {
      Bucket: bucket,
      Key: key,
    };

    await s3.deleteObject(params).promise();
  } catch (error) {
    console.error('S3 delete error:', error);
    throw error;
  }
};

// Delete multiple files from S3
export const deleteMultipleFromS3 = async (
  keys: string[],
  bucket: string = process.env.S3_BUCKET!
): Promise<void> => {
  try {
    if (keys.length === 0) return;

    const params = {
      Bucket: bucket,
      Delete: {
        Objects: keys.map(key => ({ Key: key })),
        Quiet: false,
      },
    };

    await s3.deleteObjects(params).promise();
  } catch (error) {
    console.error('S3 batch delete error:', error);
    throw error;
  }
};

// Copy file within S3
export const copyWithinS3 = async (
  sourceKey: string,
  destinationKey: string,
  sourceBucket: string = process.env.S3_BUCKET!,
  destinationBucket: string = process.env.S3_BUCKET!
): Promise<void> => {
  try {
    const params = {
      Bucket: destinationBucket,
      CopySource: `${sourceBucket}/${sourceKey}`,
      Key: destinationKey,
      ACL: 'public-read',
    };

    await s3.copyObject(params).promise();
  } catch (error) {
    console.error('S3 copy error:', error);
    throw error;
  }
};

// Check if file exists
export const fileExists = async (
  key: string,
  bucket: string = process.env.S3_BUCKET!
): Promise<boolean> => {
  try {
    await s3.headObject({ Bucket: bucket, Key: key }).promise();
    return true;
  } catch (error) {
    if ((error as AWS.AWSError).code === 'NotFound') {
      return false;
    }
    throw error;
  }
};

// Get file metadata
export const getFileMetadata = async (
  key: string,
  bucket: string = process.env.S3_BUCKET!
): Promise<AWS.S3.HeadObjectOutput> => {
  try {
    return await s3.headObject({ Bucket: bucket, Key: key }).promise();
  } catch (error) {
    console.error('S3 metadata error:', error);
    throw error;
  }
};

// List files with prefix
export const listFiles = async (
  prefix: string,
  maxKeys: number = 1000,
  bucket: string = process.env.S3_BUCKET!
): Promise<AWS.S3.Object[]> => {
  try {
    const params = {
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: maxKeys,
    };

    const result = await s3.listObjectsV2(params).promise();
    return result.Contents || [];
  } catch (error) {
    console.error('S3 list error:', error);
    throw error;
  }
};

// Create multipart upload
export const createMultipartUpload = async (
  key: string,
  contentType: string,
  bucket: string = process.env.S3_BUCKET!
): Promise<string> => {
  try {
    const params = {
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      ACL: 'public-read',
    };

    const result = await s3.createMultipartUpload(params).promise();
    return result.UploadId!;
  } catch (error) {
    console.error('S3 multipart upload creation error:', error);
    throw error;
  }
};

// Generate presigned URL for multipart upload part
export const generateMultipartUploadUrl = async (
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn: number = 3600,
  bucket: string = process.env.S3_BUCKET!
): Promise<string> => {
  try {
    const params = {
      Bucket: bucket,
      Key: key,
      PartNumber: partNumber,
      UploadId: uploadId,
      Expires: expiresIn,
    };

    return s3.getSignedUrl('uploadPart', params);
  } catch (error) {
    console.error('Multipart upload URL generation error:', error);
    throw error;
  }
};

// Complete multipart upload
export const completeMultipartUpload = async (
  key: string,
  uploadId: string,
  parts: Array<{ ETag: string; PartNumber: number }>,
  bucket: string = process.env.S3_BUCKET!
): Promise<AWS.S3.CompleteMultipartUploadOutput> => {
  try {
    const params = {
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts,
      },
    };

    return await s3.completeMultipartUpload(params).promise();
  } catch (error) {
    console.error('Complete multipart upload error:', error);
    throw error;
  }
};

// Abort multipart upload
export const abortMultipartUpload = async (
  key: string,
  uploadId: string,
  bucket: string = process.env.S3_BUCKET!
): Promise<void> => {
  try {
    const params = {
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    };

    await s3.abortMultipartUpload(params).promise();
  } catch (error) {
    console.error('Abort multipart upload error:', error);
    throw error;
  }
};
