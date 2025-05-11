"use strict";

import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js";
import "dotenv/config";

//const AWS = require('aws-sdk');
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

import mime from 'mime-types';
import fs from "fs";
import path from "path";
//import { PassThrough } from "stream";
import OpenAI from 'openai';

// OpenAI 클라이언트 초기화
const openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY // .env 파일에 OPENAI_API_KEY를 추가해야 합니다
});

//const app = express();
//const upload = multer({ dest: 'uploads/' });
// ✅ AWS S3 설정 (v3)
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME; // 버킷 이름 변수화

class S3_Bucket {
    constructor(body) {
        this.body = body;
    }

    async getImageDescription(userMsg, imagePath) {
        try {
            // Validate input path
            if (!imagePath || typeof imagePath !== 'string') {
                throw new Error('유효한 이미지 경로를 입력해주세요.');
            }
    
            // Check if file exists
            if (!fs.existsSync(imagePath)) {
                throw new Error('이미지 파일을 찾을 수 없습니다.');
            }
    
            // 파일 타입 확인 방법 1: 원본 파일의 MIME 타입 사용
            let mimeType = this.body.file.mimetype;
            
            // 파일 타입 확인 방법 2: 확장자로 확인
            if (!mimeType) {
                const originalExt = path.extname(this.body.file.originalname).toLowerCase();
                if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(originalExt)) {
                    mimeType = `image/${originalExt.slice(1)}`;
                }
            }
            console.log("Original mimetype:", mimeType);
        
            if (!mimeType || !mimeType.startsWith('image/')) {
                throw new Error('유효한 이미지 파일이 아닙니다.');
            }
    
            const imageBuffer = await fs.promises.readFile(imagePath);
            const base64Image = imageBuffer.toString('base64');
    
            const response = await openaiClient.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: "당신은 이미지 설명을 제공하는 AI입니다. user message를 참고하여 상세하고 정확한 설명을 제공해주세요."
                    },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: userMsg },    // + " 이 이미지에 대해 자세히 설명해 주세요."
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${mimeType};base64,${base64Image}`,
                                    detail: "high"
                                }                                
                            }
                        ]
                    }
                ],
                max_tokens: 300,
                temperature: 0.7, // 적절한 창의성 수준 설정
            });
    
            // 응답 검증
            if (!response.choices || !response.choices[0]?.message?.content) {
                throw new Error('API 응답이 올바르지 않습니다.');
            }
    
            return response.choices[0].message.content;
    
        } catch (error) {
            console.error("❌ OpenAI Vision API 호출 실패:", error.message);
            throw new Error(`이미지 분석 실패: ${error.message}`);
        }
    }    

    // ✅ S3에 폴더가 존재하는지 확인
    static async checkFolderExists(folderName) {
        try {
            const command = new HeadObjectCommand({
                Bucket: S3_BUCKET_NAME,
                Key: `${folderName}/` // 폴더 경로
            });

            await s3.send(command);
            console.log(`✅ 폴더 존재함: ${folderName}/`);
            return true;
        } catch (error) {
            if (error.name === "NotFound") {
                console.log(`🚀 폴더 없음, 새로 생성: ${folderName}/`);
                return false;
            }
            console.error("❌ S3 폴더 확인 오류:", error);
            throw error;
        }
    }

    // ✅ S3에 폴더 생성 (빈 오브젝트 업로드)
    static async createFolder(folderName) {
        try {
            const command = new PutObjectCommand({
                Bucket: S3_BUCKET_NAME,
                Key: `${folderName}/`, // 폴더처럼 사용 (빈 파일 업로드)
                Body: ""
            });

            await s3.send(command);
            console.log(`✅ S3 폴더 생성 완료: ${folderName}/`);
        } catch (error) {
            console.error("❌ S3 폴더 생성 오류:", error);
            throw error;
        }
    }

    // --- 스트림 데이터 업로드 함수 (신규 추가) ---
    static async uploadStreamData(inputData, streamType, userId, sessionId) {
        if (!['audio', 'video'].includes(streamType)) {
            throw new Error('Invalid streamType. Must be "audio" or "video".');
        }

        // ------------------------------
        // 3. S3 업로드를 위한 설정 (Buffer 또는 filePath 모두 처리)
        let Body;
        let fileExtension = '.webm';
        // inputData가 Buffer인지 파일 경로인지 판별
        if (Buffer.isBuffer(inputData)) {
            Body = inputData;
        } else {
            if (!fs.existsSync(inputData)) {
                throw new Error('File not found for S3 upload');
            }
            Body = fs.createReadStream(inputData);
            fileExtension = path.extname(inputData) || '.webm';
        }
        const folderName = `${streamType}/${userId}`;
        const fileName = `${sessionId}${fileExtension}`;
        const s3Key = `${folderName}/${fileName}`;
        let s3Url;

        console.log(`Attempting to upload stream data to S3: ${s3Key}`);
        try {
            // 📌 폴더 존재 여부 확인 후, 없으면 생성
            const folderExists = await S3_Bucket.checkFolderExists(folderName);
            if (!folderExists) {
                await S3_Bucket.createFolder(folderName);
            }
            const uploadParams = {
                Bucket: S3_BUCKET_NAME,
                Key: s3Key,
                Body: Body,
                // 스트림 데이터는 보통 public-read 가 아닐 수 있음 (필요시 ACL 조정)
                // ContentType은 자동으로 감지되거나 필요시 명시
                ContentType: mime.lookup(fileExtension) || 'application/octet-stream'
            };
            const upload = new Upload({
                client: s3,
                params: uploadParams
            });
            const s3Response = await upload.done();
            console.log(`✅ Stream data uploaded successfully to S3: ${s3Response.Key}`);
            // S3 URL 반환 (Location 필드가 있을 경우 사용, 없으면 직접 구성)
            s3Url = s3Response.Location || `https://${S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Response.Key}`;

            if (Body && Body.destroy) {
                Body.destroy();
            }

        } catch (error) {
            console.error(`❌ Error uploading stream data to S3 (${s3Key}):`, error);
            throw new Error(`Failed to upload stream data: ${error.message}`);
        }
        return s3Url;
    }

    async upload_image() {  //app.post('/upload', upload.single('image'), async (req, res) => 
        const client = this.body;

        console.log("client id:", client.id );
        //console.log("file:", client.file );
        if (!client.file) {
            console.error("No file exist");
            return { success: false, error: "No file exist." };
        }

        // userMessages를 JSON으로 파싱
        const parsedMessages = client.userMessages.Text;
        //typeof client.userMessages === 'string' ? JSON.parse(client.userMessages) : client.userMessages.toString();
        console.log("parsedMessages:", parsedMessages );

        // ---------------------------------------------
        // 1. Check if a chat session exists for today
        // ---------------------------------------------
        // We want to find a chat session for this user where the session's created_at date is today.
        // For example, we use MySQL's DATE() function together with CURDATE().
        let conversation_id;
        try {
            // Get today's date in the MySQL date format (YYYY-MM-DD)
            //const today = new Date().toISOString().split('T')[0];
            const today = new Date().toLocaleDateString('ko-KR', { 
                timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
            }).replace(/\. /g, '-').replace('.', ''); // 2025. 02. 09 → 2025-02-09 변환

            console.log("today:", today);

            const selectSessionQuery = `SELECT conversation_id FROM chat_sessions WHERE user_id = ? AND DATE(created_at) = ?;`;
            const [rows] = await db.execute(selectSessionQuery, [client.id, today]);
            if (rows.length > 0) {
                conversation_id = rows[0].conversation_id;
            } else {
                conversation_id = uuidv4();
                const insertSessionQuery = `INSERT INTO chat_sessions (conversation_id, user_id, model_name) VALUES (?, ?, ?);`;
                await db.query(insertSessionQuery, [conversation_id, client.id, 'gpt-4o-mini']);
            }
        } catch (error) {
            console.error("Error fetching or creating chat session:", error);
            return { success: false, error: "Failed to handle chat session." };
        }

        // ------------------------------
        // 2. 파일 처리: file.path 또는 file.buffer
        // ------------------------------
        let localFilePath = null;
        // 만약 multer의 diskStorage를 사용했다면 file.path가 존재함
        if (client.file.path) {
            localFilePath = client.file.path;
        }
        // 메모리 스토리지인 경우 file.buffer가 존재함
        else if (client.file.buffer) {
            // 임시 파일 저장 디렉터리 (필요시 변경)
            const tempDir = path.join(process.cwd(), 'temp');
            fs.mkdirSync(tempDir, { recursive: true });
            // 임시 파일명 생성
            localFilePath = path.join(tempDir, `${uuidv4()}-${client.file.originalname}`);
            fs.writeFileSync(localFilePath, client.file.buffer);
        } else {
            console.error("No file path or buffer available.");
            return { success: false, error: "No file path or buffer available." };
        }        

        console.log("✅ Debug - Insert Parameters:", {
            user_id: client.id,
            conversation_id: conversation_id,
            user_msg: parsedMessages,   //client.userMessages,
            file: {
                // file.path는 이제 localFilePath 변수에 저장됨
                localPath: localFilePath,
                fileName: client.file.originalname || client.file.name,
                fileType: client.file.mimetype || client.file.type,
                fileSize: client.file.size
            }            
        });

        // ------------------------------
        // 3. S3 업로드를 위한 설정
        // ------------------------------
        const clientId = client.id || "unknown"; // 사용자 ID
        const folderName = `uploads/${clientId}`; // S3 내 폴더 경로
        // S3에 저장할 파일명 (UUID + 원본 확장자)
        const fileName = `${uuidv4()}${path.extname(client.file.originalname || client.file.name)}`;
        const s3FilePath = `${folderName}/${fileName}`; // S3 상의 최종 경로

        let fileUrl, description;        
        try {
            // 📌 폴더 존재 여부 확인 후, 없으면 생성
            const folderExists = await S3_Bucket.checkFolderExists(folderName);
            if (!folderExists) {
                await S3_Bucket.createFolder(folderName);
            }

            // 📌 파일 업로드 설정
            const fileStream = fs.createReadStream(localFilePath);
            
            const uploadParams = {
                Bucket: S3_BUCKET_NAME,
                Key: s3FilePath,
                Body: fileStream,
                ACL: "public-read",
                ContentType: client.file.mimetype || client.file.type
            };

            // ✅ v3 방식으로 파일 업로드
            const upload = new Upload({
                client: s3,
                params: uploadParams
            });
            const s3Response = await upload.done();
            fileUrl = s3Response.Location || `https://${S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Response.Key}`;
            
            // OpenAI Vision API 호출
            description = await this.getImageDescription(parsedMessages, localFilePath);    //client.userMessages
           
            // 로컬 파일 삭제
            fs.unlinkSync(localFilePath);
            //res.json({ message: '업로드 완료', file_url: fileUrl });
        } catch (error) {
            console.error(error);
            return { success: false, error: "Failed to upload." };
        }

        // ---------------------------------------------
        // 4. Save the chat messages to the database
        // ---------------------------------------------
        try {
            // MySQL (RDS)에 업로드 정보 저장
            const [result] = await db.execute(
                `INSERT INTO media_files (user_id, conversation_id, s3_key, file_name, file_type, file_size, description) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    client.id,
                    conversation_id,
                    fileUrl,                // S3 URL
                    client.file.originalname || client.file.name,  // 파일명
                    client.file.mimetype || client.file.type,
                    client.file.size,
                    description             // 설명 (옵션)
                ]
            );
        }
        catch (error) {
            console.error("Error saving upload image info to DB:", error);
            return { success: false, error: "Failed to save Image info." };
        }

        // ---------------------------------------------
        // 4. Save the chat messages to the database
        // ---------------------------------------------
        try {
            // Save each user message as a 'question'
            if (parsedMessages !== '') {
                //let user_msg = parsedMessages.toString().replace(/\r?\n/g, ' ');
                const insertUserMsgQuery = `
                    INSERT INTO chat_messages (conversation_id, user_id, q_a, message)
                    VALUES (?, ?, ?, ?);
                `;
                await db.query(insertUserMsgQuery, [conversation_id, client.id, 'question', parsedMessages]);
            }

            // Save each user message as a 'question'
            if(description.length >= 1) {
                let ans_msg = description.replace(/\r?\n/g, ' ');
                const insertAnswerMsgQuery = `
                    INSERT INTO chat_messages (conversation_id, user_id, q_a, message)
                    VALUES (?, ?, ?, ?);
                `;
                await db.query(insertAnswerMsgQuery, [conversation_id, client.id, 'answer', ans_msg]);
            }
        } catch (error) {
            console.error("Error saving photo explane to DB:", error);
            return { success: false, error: "Failed to save photo explane." };
        }
        return { success: true, message: "upload complete.", file_url: fileUrl, file_desc: description };
    }
}

export default S3_Bucket;