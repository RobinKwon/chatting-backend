"use strict";

import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js";
import "dotenv/config";

//import express from "express";
//import multer from "multer";
//import AWS from "aws-sdk";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "fs";
import path from "path";
import openai from "openai";

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

class S3_Bucket {
    constructor(body) {
        this.body = body;
    }

    // ✅ ChatGPT Vision을 이용한 이미지 설명 요청
    async getImageDescription(imagePath) {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            const base64Image = imageBuffer.toString('base64');

            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "당신은 이미지 설명을 제공하는 AI입니다." },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "이 이미지에 대해 설명해 주세요." },
                            { type: "image_url", image_url: `data:image/jpeg;base64,${base64Image}` }
                        ]
                    }
                ],
                max_tokens: 300
            });

            return response.choices[0].message.content;
        } catch (error) {
            console.error("❌ OpenAI Vision API 호출 실패:", error);
            return "이미지를 분석할 수 없습니다.";
        }
    }    

    // ✅ S3에 폴더가 존재하는지 확인
    async checkFolderExists(folderName) {
        try {
            const command = new HeadObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
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
    async createFolder(folderName) {
        try {
            const command = new PutObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
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

    async upload_image() {  //app.post('/upload', upload.single('image'), async (req, res) => 
        const client = this.body;

        if (!client.file) {
            return { success: false, error: "No file exist." };
        }

        // ---------------------------------------------
        // 1. Check if a chat session exists for today
        // ---------------------------------------------
        // We want to find a chat session for this user where the session’s created_at date is today.
        // For example, we use MySQL’s DATE() function together with CURDATE().
        let conversation_id;
        let fileUrl;
        let description;
        try {
            // Get today’s date in the MySQL date format (YYYY-MM-DD)
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

        console.log("✅ Debug - Insert Parameters:", {
            user_id: client.id,
            conversation_id: conversation_id,
            //fileUrl: fileUrl,
            file: client.file,
            path: client.file.path,
            fileName: client.file.originalname,
            fileType: client.file.mimetype,
            fileSize: client.file.size,
            //description: description
        });

        //const fileContent = fs.readFileSync(client.file.path);
        const clientId = client.id || "unknown"; // 사용자 ID
        const folderName = `uploads/${clientId}`; // S3 내 폴더 경로
        const fileName = `${uuidv4()}${path.extname(client.file.originalname)}`;
        const filePath = `${folderName}/${fileName}`; // 최종 파일 경로

        // ---------------------------------------------
        // 2. upload image to S3
        // ---------------------------------------------
        try {
            // 📌 폴더 존재 여부 확인 후, 없으면 생성
            const folderExists = await this.checkFolderExists(folderName);
            if (!folderExists) {
                await this.createFolder(folderName);
            }

            // 📌 파일 업로드 설정
            const fileStream = fs.createReadStream(client.file.path);
            const uploadParams = {
                Bucket: process.env.S3_BUCKET_NAME,
                Key: filePath,
                Body: fileStream,
                ACL: "public-read",
                ContentType: client.file.mimetype
            };

            // ✅ v3 방식으로 파일 업로드
            const upload = new Upload({
                client: s3,
                params: uploadParams
            });
            const s3Response = await upload.done();
            fileUrl = s3Response.Location;
            
            // OpenAI Vision API 호출
            description = await this.getImageDescription(client.file.path);
           
            // 로컬 파일 삭제
            fs.unlinkSync(client.file.path);
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
                    client.file.originalname,  // 파일명
                    client.file.mimetype,
                    client.file.size,
                    description                    // 설명 (옵션)
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
            if(client.userMessages.length >= 1) {
                let msg = description.replace(/\r?\n/g, ' ');
                const insertUserMsgQuery = `
                    INSERT INTO chat_messages (conversation_id, user_id, q_a, message)
                    VALUES (?, ?, ?, ?);
                `;
                await db.query(insertUserMsgQuery, [conversation_id, client.id, 'file', msg]);
            }
        } catch (error) {
            console.error("Error saving photo explane to DB:", error);
            return { success: false, error: "Failed to save photo explane." };
        }
        return { success: true, message: "upload complete." };
    }
}

export default S3_Bucket;