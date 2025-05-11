import WebSocket from 'ws';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import db from "../config/db.js";
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import S3Bucket from './S3Bucket.js';
import { exec } from 'child_process';
import { PassThrough } from 'stream';
import { Upload } from '@aws-sdk/lib-storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// AWS 및 OpenAI 설정
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 임시 파일 저장 디렉토리 생성
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// WebSocket 서버 설정 및 연결 처리 함수
export function setupWebSocket(server) {
  const wss = new WebSocket.Server({
    server,
    path: '/ws',
    perMessageDeflate: false
  });

  wss.on('connection', (ws) => {
    console.log('클라이언트가 연결되었습니다');

    let audioBuffer = Buffer.from([]);
    let videoHeaderBuffer = null;
    // Streaming S3 업로드용
    let videoUploadStream = null;
    let videoUploader = null;
    // S3 업로드된 비디오 URL
    let videoS3Url = null;

    let currentSessionId = null;
    let currentUserId = null;   // userId를 저장할 변수 추가

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        if(data.type === 'video_data' || data.type === 'audio_data') { 
          console.log(`Received message type=${data.type}, userId=${currentUserId}, sessionId=${currentSessionId}`);
        }
        else {
          console.log('Received message:', data); // 수신 메시지 로깅 추가
        }

        if (data.type === 'start_session') {
          // 세션 ID 생성 및 userId 저장
          currentSessionId = uuidv4();
          currentUserId = data.userId; // 클라이언트에서 보낸 userId 저장

          if (!currentUserId) {
             console.error('userId is missing in start_session message');
             ws.send(JSON.stringify({ type: 'error', message: '사용자 ID가 누락되었습니다.' }));
             return; // userId 없으면 처리 중단
          }

          //250419_2242:session id를 DB에 등록
          try {
            const [result] = await db.execute(
              "INSERT INTO chat_sessions (conversation_id, user_id, model_name, created_at) VALUES(?, ?, ?, NOW())",
              [currentSessionId, currentUserId, "gpt-4o-mini"]
            );
          } catch (err) {
            throw new Error(`DB 등록 실패: ${err.message}`);
          }

          console.log(`새 세션 시작: userId=${currentUserId}, sessionId=${currentSessionId}`);
          // S3 멀티파트 업로드 스트림 초기화
          const folderName = `video/${currentUserId}`;
          const folderExists = await S3Bucket.checkFolderExists(folderName);
          if (!folderExists) await S3Bucket.createFolder(folderName);
          const s3Key = `${folderName}/${currentSessionId}.webm`;
          // 업로드된 비디오 URL 구성
          videoS3Url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
          videoUploadStream = new PassThrough();
          videoUploader = new Upload({
            client: s3Client,
            params: { Bucket: process.env.S3_BUCKET_NAME, Key: s3Key, Body: videoUploadStream, ContentType: 'video/webm' }
          });
          videoUploader.done()
            .then(() => console.log(`S3 streaming uploaded: ${s3Key}`))
            .catch(err => console.error('S3 streaming error:', err));
          ws.send(JSON.stringify({ type: 'session_started', sessionId: currentSessionId }));
          return;
        }
        // --- 중요 ---
        // 이후 audio_data, video_data, end_session 등 다른 메시지 처리 시
        // 반드시 currentSessionId 와 currentUserId 가 유효한지 확인하고 사용해야 합니다.
        else if (data.type === 'audio_data') {
           if (!currentUserId || !currentSessionId) {
               console.warn('Received audio_data without active session/userId');
               return; // 세션 또는 userId 없으면 처리 중단
           }
          const chunk = Buffer.from(data.data, 'base64');
          audioBuffer = Buffer.concat([audioBuffer, chunk]);
          if (data.isComplete || audioBuffer.length > 1024 * 1024) {
             // processAudioData 호출 시 userId도 전달 (필요한 경우)
            await processAudioData(audioBuffer, currentUserId, currentSessionId, ws);
            audioBuffer = Buffer.from([]);
          }
        }
        else if (data.type === 'video_data') {
          if (!currentUserId || !currentSessionId) {
              console.warn('Received video_data without active session/userId');
              return;
          }
          const chunk = Buffer.from(data.data, 'base64');
          // PassThrough를 통해 청크 단위로 S3에 업로드
          if (videoUploadStream) videoUploadStream.write(chunk);
          let bufferToProcess;
          if (!videoHeaderBuffer) {
              // Cluster ID: 0x1F43B675
              const clusterId = Buffer.from([0x1F, 0x43, 0xB6, 0x75]);
              const idx = chunk.indexOf(clusterId);
              if (idx > 0) {
                  // 헤더만 추출
                  videoHeaderBuffer = chunk.slice(0, idx);
              } else {
                  // Cluster ID 없으면 전체 청크 저장
                  videoHeaderBuffer = chunk;
              }
              // 첫 프레임 처리 시에는 전체 chunk 사용
              bufferToProcess = chunk;
          } else {
              // 이후 청크는 헤더와 결합
              bufferToProcess = Buffer.concat([videoHeaderBuffer, chunk]);
          }
          // 데이터를 처리 (에러는 로그만 남기고 무시)
          processVideoData(bufferToProcess, currentUserId, currentSessionId, ws)
            .catch(err => console.error('Video chunk 처리 중 오류:', err));
        }
        else if (data.type === 'end_session') {
           if (!currentSessionId || !currentUserId) {
               console.warn('Received end_session without active session/userId');
               return; // 세션 또는 userId 없으면 처리 중단
           }
          console.log(`세션 종료: sessionId=${currentSessionId}, userId=${currentUserId}`);
          ws.send(JSON.stringify({ type: 'session_ended', sessionId: currentSessionId }));
          // streaming 업로드 끝내기
          if (videoUploadStream) { videoUploadStream.end(); videoUploadStream = null; videoUploader = null; }
          audioBuffer = Buffer.from([]);
          videoHeaderBuffer = null;
          currentSessionId = null;
          currentUserId = null;
        }
      } catch (error) {
        console.error('메시지 처리 오류:', error);
        // 오류 발생 시에도 특정 세션 ID 전달 시도 (currentSessionId가 null이 아닐 경우)
        const errorPayload = { type: 'error', message: '서버 오류가 발생했습니다' };
        if (currentSessionId) {
            errorPayload.sessionId = currentSessionId;
        }
        ws.send(JSON.stringify(errorPayload));
      }
    });

    ws.on('close', () => {
      console.log(`클라이언트 연결 종료: sessionId=${currentSessionId}, userId=${currentUserId}`);
      // 연결 종료 시 관련 리소스 정리 (예: 진행 중인 처리 중단, 임시 버퍼 초기화 등)
      audioBuffer = Buffer.from([]);
      videoHeaderBuffer = null;
      if (videoUploadStream) {
        videoUploadStream.end();
        videoUploadStream = null;
      }
      // currentSessionId와 currentUserId는 이 스코프에서는 더 이상 유효하지 않음
    });
  });

  console.log('WebSocket 서버가 /ws 경로에 설정되었습니다.');
  return wss; // 필요시 wss 객체 반환
}

// 오디오 데이터 처리 함수
async function processAudioData(buffer, userId, sessionId, ws) {
  const timestamp = Date.now();
  const tempFilename = `${sessionId}_${userId}_audio_${timestamp}.webm`;
  const tempFilePath = path.join(tempDir, tempFilename);

  try {
    // 동일 세션에서 기존 파일이 있으면 append, 없으면 새로 생성
    if (fs.existsSync(tempFilePath)) {
      fs.appendFileSync(tempFilePath, buffer);
    } else {
      fs.writeFileSync(tempFilePath, buffer);
    }

    const s3Url = await S3Bucket.uploadStreamData(tempFilePath, 'audio', userId, sessionId);
    console.log(`Audio uploaded to S3 for user ${userId}: ${s3Url}`);

    const transcription = await transcribeAudio(tempFilePath, userId); // STT 처리
    // transcription 객체에 text 필드가 있는지 확인
    const transcriptionText = transcription && transcription.text ? transcription.text : '';
    const aiResponse = await generateAIResponse(transcriptionText, userId); // AI 응답 생성

    ws.send(JSON.stringify({
      type: 'audio_processed',
      s3Url: s3Url, // S3 URL 전송
      transcription: transcriptionText, // STT 결과 전송
      aiResponse
    }));

  } catch (error) {
    console.error(`오디오 처리 오류 (userId: ${userId}):`, error);
    ws.send(JSON.stringify({ type: 'error', message: '오디오 처리 중 오류가 발생했습니다', sessionId }));
  } finally {
     // 임시 파일 삭제 (finally 블록에서 처리)
     if (fs.existsSync(tempFilePath)) {
         try {
             fs.unlinkSync(tempFilePath);
             console.log(`Deleted temp audio file: ${tempFilePath}`);
         } catch (unlinkError) {
             console.error(`Error deleting temp audio file ${tempFilePath}:`, unlinkError);
         }
     } else {
         console.log(`Temp audio file not found for deletion: ${tempFilePath}`);
     }
  }
}

// 비디오 데이터 처리 함수
async function processVideoData(buffer, userId, sessionId, ws) {
  // 임시 파일명 생성 (프레임 추출용)
  const tempFilename = `${userId}_${sessionId}_video_temp.webm`;
  const tempFilePath = path.join(tempDir, tempFilename);
  let frameFilePath = null;

  try {
    // 프레임 분석용 임시 파일에 버퍼를 append
    fs.writeFileSync(tempFilePath, buffer, { flag: 'a' });
    
    // 이미 setupWebSocket에서 PassThrough를 통한 S3 업로드가 수행되므로,
    // 여기서는 객체 URL을 계산하여 사용
    const s3Key = `video/${userId}/${sessionId}.webm`;
    const s3Url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

    // 프레임 추출 및 분석
    frameFilePath = await extractVideoFrame(tempFilePath);
    const videoAnalysis = await analyzeVideoFrame(frameFilePath, userId);

    // ---------------------------------------------
    // 4. Save the chat messages to the database
    // ---------------------------------------------
    try {
      // MySQL (RDS)에 업로드 정보 저장
      const [result] = await db.execute(
          `INSERT INTO media_files (user_id, conversation_id, s3_key, file_name, file_type, file_size, description) 
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
              userId,
              sessionId,
              s3Url,
              tempFilename,
              'video',
              fs.statSync(tempFilePath).size,
              videoAnalysis             // 설명 (옵션)
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
        if (videoAnalysis !== '') {
            //let user_msg = parsedMessages.toString().replace(/\r?\n/g, ' ');
            const insertUserMsgQuery = `
                INSERT INTO chat_messages (conversation_id, user_id, q_a, message)
                VALUES (?, ?, ?, ?);
            `;
            await db.query(insertUserMsgQuery, [sessionId, userId, 'question', videoAnalysis]);
        }

        // Save each user message as a 'question'
        // if(description.length >= 1) {
        //     let ans_msg = description.replace(/\r?\n/g, ' ');
        //     const insertAnswerMsgQuery = `
        //         INSERT INTO chat_messages (conversation_id, user_id, q_a, message)
        //         VALUES (?, ?, ?, ?);
        //     `;
        //     await db.query(insertAnswerMsgQuery, [sessionId, userId, 'answer', ans_msg]);
        // }
    } catch (error) {
        console.error("Error saving photo explane to DB:", error);
        return { success: false, error: "Failed to save photo explane." };
    }
    //return { success: true, message: "upload complete.", file_url: fileUrl, file_desc: description };

    // 프레임 이미지 읽기
    let frameImageData = null;
    if (frameFilePath) {
      const frameBuffer = fs.readFileSync(frameFilePath);
      frameImageData = `data:image/jpeg;base64,${frameBuffer.toString('base64')}`;
    }

    ws.send(JSON.stringify({
      type: 'video_processed',
      s3Url,
      videoAnalysis,
      frameImage: frameImageData
    }));

  } catch (error) {
    console.error(`비디오 처리 오류 (userId: ${userId}):`, error);
    ws.send(JSON.stringify({ type: 'error', message: '비디오 처리 중 오류가 발생했습니다', sessionId }));
  } finally {
     // 임시 파일 정리
     if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
     if (frameFilePath && fs.existsSync(frameFilePath)) fs.unlinkSync(frameFilePath);
  }
}

// OpenAI API를 사용한 오디오 트랜스크립션 함수
async function transcribeAudio(filePath, userId) {
  try {
    // 파일 스트림 생성 확인
    const fileStream = fs.createReadStream(filePath);
    if (!fileStream) {
        throw new Error('파일 스트림 생성 실패');
    }

    // Whisper API 호출
    const transcription = await openai.audio.transcriptions.create({
        file: fileStream,
        model: "whisper-1",
    });

    // 결과 반환
    return transcription; // Whisper API는 text 필드를 포함한 객체를 반환합니다
  } catch (error) {
      console.error('오디오 트랜스크립션 오류:', error);
      // 오류 세부 정보 로깅
      if (error.response) {
          console.error('API 응답 데이터:', error.response.data);
          console.error('API 응답 상태:', error.response.status);
          console.error('API 응답 헤더:', error.response.headers);
      } else if (error.request) {
          console.error('API 요청 데이터:', error.request);
      } else {
          console.error('Error 메시지:', error.message);
      }
      throw new Error('오디오 트랜스크립션 중 오류 발생'); // 보다 구체적인 오류 메시지 또는 처리
  }
}

// 비디오 프레임 추출 함수 (FFmpeg 필요)
async function extractVideoFrame(videoPath) {
  const outputPath = videoPath.replace('.webm', '_frame.jpg');
  
  // FFmpeg 경로 설정 (환경에 맞게 수정 필요)
  const ffmpegPath = path.join('D:', 'ffmpeg-2025-04-17-git-7684243fbe-full_build', 'bin', 'ffmpeg.exe');

  return new Promise((resolve, reject) => {
    // FFmpeg 명령어 개선 - WebM 파일 처리를 위한 옵션 추가
    const command = `"${ffmpegPath}" -y -fflags +genpts -i "${videoPath}" -vf "select=eq(n\\,0)" -frames:v 1 -q:v 2 "${outputPath}"`;
    
    console.log('Executing FFmpeg command:', command);
    
    exec(command, (error, stdout, stderr) => {
      // FFmpeg stderr는 정보용으로만 로그
      //if (stderr) console.log('FFmpeg stderr (info):', stderr);   //250420_2233:no console log ffmpeg stderr
      // 에러 발생 시 프레임 추출을 스킵하고 null 반환
      if (error) {
        console.warn('FFmpeg parsing failed, skipping frame extraction:', error.message);
        return resolve(null);
      }

      // 파일 크기 확인, 비어있으면 스킵
      try {
        const stats = fs.statSync(outputPath);
        if (stats.size === 0) {
          console.warn('Extracted frame file is empty, skipping frame extraction');
          return resolve(null);
        }
      } catch (statError) {
        console.warn('Frame file check failed, skipping frame extraction:', statError.message);
        return resolve(null);
      }

      console.log(`비디오 프레임 추출 성공: ${outputPath}`);
      resolve(outputPath);
    });
  });
}

// [수정됨] OpenAI API를 사용한 비디오 프레임 분석 함수
async function analyzeVideoFrame(imagePath, userId) {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = 'image/jpeg'; // 추출된 프레임이 jpg라고 가정

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", //"gpt-4-vision-preview", // 또는 "gpt-4o" 사용 가능
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "이 이미지에 대해 설명해주세요." },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 300,
    });

    if (!response.choices || !response.choices[0]?.message?.content) {
      throw new Error('API 응답에서 설명을 찾을 수 없습니다.');
    }
    return response.choices[0].message.content;
  } catch (error) {
    console.error('비디오 프레임 분석 오류:', error);
    return '이미지 분석 중 오류가 발생했습니다.'; // 오류 발생 시 기본 메시지 반환
  }
}

// OpenAI API를 사용한 AI 응답 생성 함수
async function generateAIResponse(userMessage, userId) {
  try {
    console.log(`Generating AI response for user ${userId} with message: ${userMessage}`);
    // 필요하다면 userId를 사용하여 사용자별 context나 프롬프트 조정
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `당신은 사용자 ${userId}의 친절한 AI 친구입니다.` }, // userId 활용 예시
        { role: "user", content: userMessage }
      ],
      max_tokens: 500,
      temperature: 0.7
    });
    
    if (!response.choices || !response.choices[0]?.message?.content) {
      throw new Error('API 응답에서 내용을 찾을 수 없습니다.');
    }
    return response.choices[0].message.content;
  } catch (error) {
    console.error(`AI 응답 생성 오류 (userId: ${userId}):`, error);
    return 'AI 응답 생성 중 오류가 발생했습니다.';
  }
}
