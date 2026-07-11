#include <LeapC.h>
#include <stdio.h>
#include <stdlib.h>
#include <inttypes.h>
#include "utils.h"
#include <math.h>

int leapFrameToJSON(const LEAP_TRACKING_EVENT* frame, LEAP_HAND* hands, char *buf) {
	const char* payload =
		"{"
			"\"currentFrameRate\": %f,"
			"\"devices\": [],"
			"\"id\": %" PRId64 ","
			"\"timestamp\": %" PRId64 ","
			"\"hands\": %s,"
			"\"pointables\": %s"
		"}";

	char* handBuf = (char*)malloc(LEAP_HANDS_MAX_SIZE);
	char* pointablesBuf = (char*)malloc(LEAP_POINTABLES_MAX_SIZE);

	leapHandsToJSON(handBuf, frame->pHands, frame->nHands);
	leapHandsToPointablesJSON(pointablesBuf, frame->pHands, frame->nHands);

	int len = sprintf(buf,
		payload
		, frame->framerate
		, frame->tracking_frame_id
		, frame->info.timestamp
		, handBuf
		, pointablesBuf
	);

	free(handBuf);
	free(pointablesBuf);

	return len;
}

int leapHandsToJSON(char *buf, LEAP_HAND* hands, int count) {
	char* payload = (char*)malloc(JSON_LIST_FORMAT_SIZE);
	int length = createJSONListFormat(payload, count);

	if (payload == NULL) {
		return 0;
	}

	switch (count)
	{
	case 0:
		length = sprintf(buf, payload);
		break;
	case 1: {
		char* hand = (char*)malloc(LEAP_HAND_MAX_SIZE);
		leapHandToJSON(hand, hands[0]);
		length = sprintf(buf, payload, hand);
		free(hand);
		break;
	}
	case 2: {
		char* firstHand = (char*)malloc(LEAP_HAND_MAX_SIZE);
		char* secondHand = (char*)malloc(LEAP_HAND_MAX_SIZE);
		leapHandToJSON(firstHand, hands[0]);
		leapHandToJSON(secondHand, hands[1]);
		length = sprintf(buf, payload, firstHand, secondHand);
		free(firstHand);
		free(secondHand);
		break;
	}
	default:
		length = sprintf(buf, "undefined");
		break;
	}

	free(payload);

	return length;
}

int leapHandToJSON(char* buf, LEAP_HAND hand) {
	char* payload =
		"{"
			"\"armBasis\": ["
				"[%f,%f,%f],"
				"[%f,%f,%f],"
				"[%f,%f,%f]"
			"],"
			"\"armWidth\": %f,"
			"\"confidence\": %f,"
			"\"direction\": [%f,%f,%f],"
			"\"elbow\": [%f,%f,%f],"
			"\"grabAngle\": %f,"
			"\"grabStrength\": %f,"
			"\"id\": %" PRIu32 ","
			"\"palmNormal\": [%f,%f,%f],"
			"\"palmPosition\": [%f,%f,%f],"
			"\"palmVelocity\": [%f,%f,%f],"
			"\"palmWidth\": %f,"
			"\"pinchDistance\": %f,"
			"\"pinchStrength\": %f,"
			"\"timeVisible\": %f,"
			"\"type\": %s,"
			"\"wrist\": [%f,%f,%f]"
		"}";

	float* mat = getBoneBasis(hand.arm.prev_joint, hand.arm.rotation);

	int length = sprintf(buf, payload,
		mat[0], mat[1], mat[2],
		mat[3], mat[4], mat[5],
		mat[6], mat[7], mat[8],
		hand.arm.width,
		hand.confidence,
		hand.palm.direction.x, hand.palm.direction.y, hand.palm.direction.z,
		hand.arm.prev_joint.x, hand.arm.prev_joint.y, hand.arm.prev_joint.z,
		hand.grab_angle,
		hand.grab_strength,
		hand.id,
		hand.palm.normal.x, hand.palm.normal.y, hand.palm.normal.z,
		hand.palm.position.x, hand.palm.position.y, hand.palm.position.z,
		hand.palm.velocity.x, hand.palm.velocity.y, hand.palm.velocity.z,
		hand.palm.width,
		hand.pinch_distance,
		hand.pinch_strength,
		hand.visible_time / 1000000.0,
		hand.type == eLeapHandType_Left ? "\"left\"" : "\"right\"",
		hand.arm.next_joint.x, hand.arm.next_joint.y, hand.arm.next_joint.z
	);

	free(mat);

	return length;
}

int leapHandToPointablesJSON(char* buf, LEAP_HAND hand) {
	const char* payload = "%s, %s, %s, %s, %s";
	uint32_t handId = hand.id;

	char* thumb = (char*)malloc(LEAP_FINGER_MAX_SIZE);
	char* index = (char*)malloc(LEAP_FINGER_MAX_SIZE);
	char* middle = (char*)malloc(LEAP_FINGER_MAX_SIZE);
	char* ring = (char*)malloc(LEAP_FINGER_MAX_SIZE);
	char* pinky = (char*)malloc(LEAP_FINGER_MAX_SIZE);

	leapFingerToPointableJSON(thumb, hand.thumb, hand.id, 0);
	leapFingerToPointableJSON(index, hand.index, hand.id, 1);
	leapFingerToPointableJSON(middle, hand.middle, hand.id, 2);
	leapFingerToPointableJSON(ring, hand.ring, hand.id, 3);
	leapFingerToPointableJSON(pinky, hand.pinky, hand.id, 4);

	int length = sprintf(buf, payload,
		thumb,
		index,
		middle,
		ring,
		pinky
	);

	free(thumb);
	free(index);
	free(middle);
	free(ring);
	free(pinky);

	return length;
}

int leapFingerToPointableJSON(char* buf, LEAP_DIGIT finger, uint32_t handId, int type) {
	char* payload =
		"{"
			"\"bases\": ["
				"["
					"[%f,%f,%f],"
					"[%f,%f,%f],"
					"[%f,%f,%f]"
				"],"
				"["
					"[%f,%f,%f],"
					"[%f,%f,%f],"
					"[%f,%f,%f]"
				"],"
				"["
					"[%f,%f,%f],"
					"[%f,%f,%f],"
					"[%f,%f,%f]"
				"],"
				"["
					"[%f,%f,%f],"
					"[%f,%f,%f],"
					"[%f,%f,%f]"
				"]"
			"],"
			"\"btipPosition\": [%f,%f,%f],"
			"\"carpPosition\": [%f,%f,%f],"
			"\"dipPosition\": [%f,%f,%f],"
			"\"mcpPosition\": [%f,%f,%f],"
			"\"pipPosition\": [%f,%f,%f],"
			"\"tipPosition\": [%f,%f,%f],"
			"\"direction\": [%f,%f,%f],"
			"\"extended\": %s,"
			"\"handId\": %" PRIu32 ","
			"\"id\": %" PRId32 ","
			"\"length\": %f,"
			"\"type\": %d,"
			"\"width\": %f"
		"}";

	float* mcpMat = getBoneBasis(finger.metacarpal.prev_joint, finger.metacarpal.rotation);
	float* prxMat = getBoneBasis(finger.proximal.prev_joint, finger.proximal.rotation);
	float* mdlMat = getBoneBasis(finger.intermediate.prev_joint, finger.intermediate.rotation);
	float* disMat = getBoneBasis(finger.distal.prev_joint, finger.distal.rotation);

	float* direction = getFingerDirection(finger.distal, finger.metacarpal);

	float avgWidth = getAvgPointableWidth(finger) / 10.0;

	int length = sprintf(buf, payload,
		mcpMat[0], mcpMat[1], mcpMat[2],
		mcpMat[3], mcpMat[4], mcpMat[5],
		mcpMat[6], mcpMat[7], mcpMat[8],

		prxMat[0], prxMat[1], prxMat[2],
		prxMat[3], prxMat[4], prxMat[5],
		prxMat[6], prxMat[7], prxMat[8],

		mdlMat[0], mdlMat[1], mdlMat[2],
		mdlMat[3], mdlMat[4], mdlMat[5],
		mdlMat[6], mdlMat[7], mdlMat[8],

		disMat[0], disMat[1], disMat[2],
		disMat[3], disMat[4], disMat[5],
		disMat[6], disMat[7], disMat[8],

		finger.distal.next_joint.x, finger.distal.next_joint.y, finger.distal.next_joint.z,						// Tip
		finger.metacarpal.prev_joint.x, finger.metacarpal.prev_joint.y, finger.metacarpal.prev_joint.z,			// Base end of metacarp (closest to wrist)
		finger.distal.prev_joint.x, finger.distal.prev_joint.y, finger.distal.prev_joint.z,						// Base of distal (closest to intermediate)
		finger.metacarpal.next_joint.x, finger.metacarpal.next_joint.y, finger.metacarpal.next_joint.z,			// Between metacarp and proximal
		finger.proximal.next_joint.x, finger.proximal.next_joint.y, finger.proximal.next_joint.z,				// Between proximal and intermediate
		finger.distal.next_joint.x, finger.distal.next_joint.y, finger.distal.next_joint.z,						// Tip
		direction[0], direction[1], direction[2],
		finger.is_extended ? "true" : "false",
		handId,
		(handId * 10) + finger.finger_id,
		finger.distal.width,																					// Return the width of the distal
		type,
		avgWidth
	);

	free(mcpMat);
	free(prxMat);
	free(mdlMat);
	free(disMat);

	free(direction);

	return length;
}

int leapHandsToPointablesJSON(char *buf, LEAP_HAND* hands, int count) {
	char* payload = (char*)malloc(JSON_LIST_FORMAT_SIZE);
	int length = createJSONListFormat(payload, count);

	if (payload == NULL) {
		return 0;
	}

	switch (count)
	{
	case 0:
		length = sprintf(buf, payload);
		break;
	case 1: {
		char* hand = (char*)malloc(LEAP_HAND_POINTABLES_MAX_SIZE);
		leapHandToPointablesJSON(hand, hands[0]);
		length = sprintf(buf, payload, hand);
		free(hand);
		break;
	}
	case 2: {
		char* firstHand = (char*)malloc(LEAP_HAND_POINTABLES_MAX_SIZE);
		char* secondHand = (char*)malloc(LEAP_HAND_POINTABLES_MAX_SIZE);
		leapHandToPointablesJSON(firstHand, hands[0]);
		leapHandToPointablesJSON(secondHand, hands[1]);
		length = sprintf(buf, payload, firstHand, secondHand);
		free(firstHand);
		free(secondHand);
		break;
	}
	default:
		break;
	}

	free(payload);

	return length;
}

int createJSONListFormat(char *buf, int count) {
	const char* payload =
		"["
		"%s"
		"]";

	int length = 4;

	switch (count)
	{
	case 0:
		length = sprintf(buf, payload, "");
		break;
	case 1:
		length = sprintf(buf, payload, "%s");
		break;
	case 2:
		length = sprintf(buf, payload, "%s,%s");
		break;
	default:
		break;
	}

	return length;
}

// Source: https://www.flipcode.com/documents/matrfaq.html#Q54
float* quaternionToMatrix(float* quaternion) {
	float* mat = (float*)malloc(9 * sizeof(float));
	if (mat == NULL) {
		return NULL;
	}

	float X = quaternion[0];
	float Y = quaternion[1];
	float Z = quaternion[2];
	float W = quaternion[3];

	float xx = X * X;
	float xy = X * Y;
	float xz = X * Z;
	float xw = X * W;

	float yy = Y * Y;
	float yz = Y * Z;
	float yw = Y * W;

	float zz = Z * Z;
	float zw = Z * W;

	mat[0] = 1 - 2 * (yy + zz);
	mat[1] = 2 * (xy - zw);
	mat[2] = 2 * (xz + yw);

	mat[3] = 2 * (xy + zw);
	mat[4] = 1 - 2 * (xx + zz);
	mat[5] = 2 * (yz - xw);

	mat[6] = 2 * (xz - yw);
	mat[7] = 2 * (yz + xw);
	mat[8] = 1 - 2 * (xx + yy);

	return mat;
}

float* leapQuaternionToMatrix(LEAP_QUATERNION quaternion) {
	float quat[4] = {
		quaternion.x,
		quaternion.y,
		quaternion.z,
		quaternion.w
	};

	float* mat = quaternionToMatrix(quat);

	return mat;
}

// Inspired by https://github.com/ultraleap/UnityPlugin/blob/5323ddaa13c23bb8ceba7815b0786c195e922cc2/Packages/Tracking/Core/Runtime/Plugins/LeapCSharp/LeapTransform.cs#L233
float* getBoneBasis(LEAP_VECTOR prevJoint, LEAP_QUATERNION rotation) {
	float scale[3] = { 1, 1, 1 };

	float d = getLeapQuaternionMagnitudeSquared(rotation);
	float s = 2.0f / d;
	float xs = rotation.x * s, ys = rotation.y * s, zs = rotation.z * s;
	float wx = rotation.w * xs, wy = rotation.w * ys, wz = rotation.w * zs;
	float xx = rotation.x * xs, xy = rotation.x * ys, xz = rotation.x * zs;
	float yy = rotation.y * ys, yz = rotation.y * zs, zz = rotation.z * zs;

	float xBasis[3] = { 1.0f - (yy + zz), xy + wz, xz - wy };
	float yBasis[3] = { xy - wz, 1.0f - (xx + zz), yz + wx };
	float zBasis[3] = { xz + wy, yz - wx, 1.0f - (xx + yy) };

	float* mat = (float*)malloc(9 * sizeof(float));
	if (mat == NULL) {
		printf("Couldn't allocate memory for bone basis\n");
		return NULL;
	}
	mat[0] = xBasis[0];
	mat[1] = xBasis[1];
	mat[2] = xBasis[2];
	mat[3] = yBasis[0];
	mat[4] = yBasis[1];
	mat[5] = yBasis[2];
	mat[6] = zBasis[0];
	mat[7] = zBasis[1];
	mat[8] = zBasis[2];
	return mat;
}

// Inspired by https://github.com/ultraleap/UnityPlugin/blob/5323ddaa13c23bb8ceba7815b0786c195e922cc2/Packages/Tracking/Core/Runtime/Plugins/LeapCSharp/LeapQuaternion.cs#L116
float getLeapQuaternionMagnitudeSquared(LEAP_QUATERNION quaternion) {
	return quaternion.x * quaternion.x + quaternion.y * quaternion.y + quaternion.z * quaternion.z + quaternion.w * quaternion.w;
}

float* getBoneDirection(LEAP_BONE bone) {
	float* direction = (float*)malloc(3 * sizeof(float));
	if (direction == NULL) {
		printf("Couldn't allocate memory for bone direction\n");
		return NULL;
	}

	direction[0] = bone.next_joint.x - bone.prev_joint.x;
	direction[1] = bone.next_joint.y - bone.prev_joint.y;
	direction[2] = bone.next_joint.z - bone.prev_joint.z;

	float magnitude = getMagnitude(direction);
	direction[0] /= magnitude;
	direction[1] /= magnitude;
	direction[2] /= magnitude;

	return direction;
}

float* getFingerDirection(LEAP_BONE tip, LEAP_BONE base) {
	float* direction = (float*)malloc(3 * sizeof(float));
	if (direction == NULL) {
		printf("Couldn't allocate memory for finger direction\n");
		return NULL;
	}

	direction[0] = tip.next_joint.x - base.prev_joint.x;
	direction[1] = tip.next_joint.y - base.prev_joint.y;
	direction[2] = tip.next_joint.z - base.prev_joint.z;

	float magnitude = getMagnitude(direction);
	direction[0] /= magnitude;
	direction[1] /= magnitude;
	direction[2] /= magnitude;

	return direction;
}

float getMagnitude(float* vector) {
	return sqrt(pow(vector[0], 2) + pow(vector[1], 2) + pow(vector[2], 2));
}

int setBit(int data, int row) {
	return data |= 1 << row;
}

int clearBit(int data, int row) {
	return data &= ~(1 << row);
}

bool isBitSet(int data, int row) {
	return ((data >> row) & 1) == 1;
}

float getAvgPointableWidth(LEAP_DIGIT finger) {
	return finger.metacarpal.width
		+ finger.proximal.width
		+ finger.intermediate.width
		+ finger.distal.width
		/ 4.0;
}

const char* ultraleapResultToCharArray(eLeapRS result) {
	switch (result)
	{
	case eLeapRS_Success:
		return "Success";
		break;
	case eLeapRS_TimestampTooEarly:
		return "Timestap too early";
		break;
	case eLeapRS_RoutineIsNotSeer:
		return "Routine is not Seer";
		break;
	case eLeapRS_NotConnected:
		return "Not connected";
		break;
	case eLeapRS_UnknownError:
		return "Unknown error";
		break;
	case eLeapRS_InvalidArgument:
		return "Invalid argument";
		break;
	case eLeapRS_InsufficientResources:
		return "Insufficient resources";
		break;
	case eLeapRS_InsufficientBuffer:
		return "Insufficient buffers";
		break;
	case eLeapRS_Timeout:
		return "Timeout";
		break;
	case eLeapRS_HandshakeIncomplete:
		return "Handshake incomplete";
		break;
	case eLeapRS_BufferSizeOverflow:
		return "Buffer size overflow";
		break;
	case eLeapRS_ProtocolError:
		return "Protocol error";
		break;
	case eLeapRS_InvalidClientID:
		return "Invalid client ID";
		break;
	case eLeapRS_UnexpectedClosed:
		return "Unexpected close";
		break;
	case eLeapRS_UnknownImageFrameRequest:
		return "Unknown image frame request";
		break;
	case eLeapRS_UnknownTrackingFrameID:
		return "Unknown tracking frame ID";
		break;
	case eLeapRS_ConcurrentPoll:
		return "Concurrent poll";
		break;
	case eLeapRS_NotAvailable:
		return "Not available";
		break;
	case eLeapRS_NotStreaming:
		return "Not streaming";
		break;
	case eLeapRS_CannotOpenDevice:
		return "Cannot open device";
		break;
	case eLeapRS_Unsupported:
		return "Unsupported";
		break;
	default:
		return "Result message conversion to string not implemented";
		break;
	}
}