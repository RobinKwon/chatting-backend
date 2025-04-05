"use strict";

import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js";
import "dotenv/config";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import OpenAI from "openai";
import dotenv from "dotenv";

// 환경 변수 로드
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


// ✅ AWS S3 설정 (v3)
//const dynamoDB = new AWS.DynamoDB.DocumentClient();
//const TABLE_NAME = process.env.SESSIONS_TABLE || `ai-chat-friend-sessions-${process.env.STAGE || 'prod'}`;
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

export const create = async (event) => {
  try {
    const sessionId = uuidv4();
    const timestamp = Date.now();
    
    const params = {
      TableName: TABLE_NAME,
      Item: {
        sessionId,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        messageCount: 0
      }
    };
    
    await dynamoDB.put(params).promise();
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({
        sessionId,
        message: '세션이 생성되었습니다.'
      })
    };
  } catch (error) {
    console.error('세션 생성 오류:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({
        error: '세션 생성 중 오류가 발생했습니다.'
      })
    };
  }
};

export const end = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const { sessionId } = body;
    
    if (!sessionId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({
          error: '세션 ID가 필요합니다.'
        })
      };
    }
    
    const params = {
      TableName: TABLE_NAME,
      Key: {
        sessionId
      },
      UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt'
      },
      ExpressionAttributeValues: {
        ':status': 'closed',
        ':updatedAt': Date.now()
      },
      ReturnValues: 'ALL_NEW'
    };
    
    const result = await dynamoDB.update(params).promise();
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({
        message: '세션이 종료되었습니다.',
        session: result.Attributes
      })
    };
  } catch (error) {
    console.error('세션 종료 오류:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({
        error: '세션 종료 중 오류가 발생했습니다.'
      })
    };
  }
};

// 기본 export를 위한 객체
export default {
  create,
  end
};