<template>
	<view style="padding: 30rpx;">
		<view style="margin-bottom: 130rpx;">
			<view class="card" style="margin-bottom: 30rpx;">
				<view class="card_top">
					{{ typetext }}
				</view>
				<!-- 				<view class="card_bottom">

				</view> -->
			</view>

			<view v-if="idtype ==4" class="card" v-for="(item, index) in outDataInfo.data2" :key="index" style="margin-bottom: 40rpx;">
				<view class="card_top">
					<span>{{item.VCNAME}}</span>
				</view>
				<view class="card_bottom">
					<view v-if="item.ISQD=='1'">
						签到时间段: {{ item.DTQDS }} - {{ item.DTQDE }}
					</view>
					<view v-if="item.ISQT=='1'">
						签退时间段: {{ item.DTQTS }} - {{ item.DTQTE }}
					</view>
				</view>
			</view>

			<view class="card" style="margin-bottom: 40rpx;">
				<view class="card_top">
					<span @click="loadInitImg()"> 识别参数 </span>
				</view>
				<uni-row style="line-height: 100rpx;margin-top: 10rpx;">
					<uni-col :span="8" style="text-align: right;">摄像头:</uni-col>
					<uni-col :span="16" style="padding-left: 30rpx;"> 后置
						<switch style="margin: 0 15rpx;" :checked="ISFRONT==true" @change="cameraChange" /> 前置
					</uni-col>
				</uni-row>

				<uni-row style="line-height: 100rpx;margin-top: 10rpx;">
					<uni-col :span="8" style="text-align: right;">活体检测:</uni-col>
					<uni-col :span="16" style="padding-left: 30rpx;"> 关闭
						<switch style="margin: 0 15rpx;" :checked="ISLIVENESS==true" @change="liveChange" /> 开启
					</uni-col>
				</uni-row>

				<uni-row style="line-height: 100rpx;">
					<uni-col :span="8" style="text-align: right;">相似度:</uni-col>
					<uni-col :span="16">
						<slider style="margin-top: 5rpx;" :value="QIFACESCORE" @change="sliderChange" min="60" max="85" show-value />
					</uni-col>
				</uni-row>
				<uni-row style="line-height: 100rpx;">
					<uni-col :span="8" style="text-align: right;">拍照质量:</uni-col>
					<uni-col :span="16">
						<slider style="margin-top: 5rpx;" :value="QIFACEQUALITY" @change="sliderQuality" min="40" max="100" show-value />
					</uni-col>
				</uni-row>

				<uni-row style="margin-bottom: 20rpx;line-height: 60rpx;">
					<uni-col :span="8" style="text-align: right;">分辨率:</uni-col>
					<uni-col :span="16" style="text-align: left;padding-left: 30rpx;padding-right: 80rpx;">
						<picker style="height: 40rpx;border: 1px solid #DCDFE6;border-radius: 4px;padding-top: 20rpx;" @change="setSize" :range="listSize" range-key="VCNAME" @click="getSize">
							<view style="height: 40rpx;line-height: 20rpx;">
								<span v-if="facePreviewSize">
									{{ facePreviewSize }}
								</span>
								<span v-else style="color: #858597;">
									请选择
								</span>
							</view>
						</picker>
					</uni-col>
				</uni-row>

				<uni-row style="margin-bottom: 20rpx;">
					<uni-col :span="8" style="text-align: right;">设备状态:</uni-col>
					<uni-col :span="6" style="text-align: left;padding-left: 30rpx;">
						{{ msg == 1 ? '已激活' : '未激活' }}
					</uni-col>
					<uni-col :span="10">
						<button style="margin-top: -10rpx;" v-if="msg != 1" @click="gotoactivation()" class="uni-btn" size="mini" type="error"> 前往激活 </button>
					</uni-col>
				</uni-row>
				<uni-row style="margin-bottom: 20rpx;">
					<uni-col style="text-align: center;">
						<button style="margin-top: 20rpx;" @click="loadInitImg()" class="uni-btn" size="mini" type="error">重新载入照片 </button>
					</uni-col>
				</uni-row>

			</view>
		</view>

		<view style="
				padding: 30rpx 20rpx;
				display: flex;
				justify-content: space-around;
				z-index:99;
				position: fixed;
				width: 100%;
				left: 0;
				bottom: 0;
				background: #EEFCF9;
			">

			<button v-if="idtype != 3" style="
					display: inline-block;
					margin-right: 30rpx;
					width: 50%;
					font-size: 32rpx;
					font-weight: 600;
					color: #FFFFFF;
					line-height: 85rpx;
					height: 85rpx;
					border-radius: 20rpx;					
					background: linear-gradient(90deg,#2868e2, #80b7fc 100%);
				" @click="clickFaceRecord()"> 刷脸记录 </button>

			<!-- 			<button
				style="
					display: inline-block;
					width: 30%;
					font-size: 32rpx;
					font-weight: 600;
					color: #FFFFFF;
					line-height: 85rpx;
					height: 85rpx;
					border-radius: 20rpx;
					background: linear-gradient(90deg,#EC3B30 0%, #ec7d7d 100%);
				"
				@click="delFace()"
			> 清空缓存 </button>		 -->

			<button :style="{
				      width: '50%',
				      marginRight: '40rpx',
				      fontSize: '32rpx',
				      fontWeight: '600',
				      color: '#FFFFFF',
				      lineHeight: '85rpx',
				      height: '85rpx',
				      borderRadius: '20rpx',
				      background: isBeginFace ? 'linear-gradient(270deg,#2fd9b1, #25d19a 100%)' : '#999999'
				    }" :disabled="!isBeginFace" @click="gotovcompare()"> 开始刷脸 </button>
		</view>

	</view>
</template>

<script>
	// #ifdef APP-PLUS
	// 配置信息初始化
	var arcFaceAppreciation = uni.requireNativePlugin("wrs-arcFaceAppreciation");
	// 人脸库管理
	var arcFaceMgr = uni.requireNativePlugin("wrs-arcFaceAppreciation-arcFaceMgr");
	// #endif
	// #ifdef APP-PLUS
	var arcFaceParamsSetting = uni.requireNativePlugin("wrs-arcFaceAppreciation-paramsSetting");
	// #endif	

	export default {
		data() {
			return {
				msg: "", // 是否激活
				dataArray: [], // 当前本地数组
				outDataInfo: {
					data1: [{}]
				}, // 基础信息
				outDataStudent: {
					data1: [{}],
					data2: [{}]
				}, // 学生数据库数据

				outDataTeacher: {
					data1: [{}],
					data2: [{}]
				},
				listSize: [],
				FACE_DTVER: 0, // 版本控制 
				FACE_DTVER_T: 0, // 教师版本控制 
				idtype: 0, // 当前刷脸类型
				typetext: '', // 类型名称
				vctype: '', // 托管类型
				vcschool: '', // 学校
				idsigntype: 0, // 托管类型ID
				faceText: '', // 二级标题 
				iddetail: '', // 班级id
				QIFACESCORE: 70,
				QIFACEQUALITY: 70,
				ISFRONT: true,
				ISLIVENESS: true,
				para: {},
				isBeginFace: false,
				vcstagename: '',
				vccoursetype: '',
				facePreviewSize: ''
			}
		},
		async onLoad(e) {




			// const ok = await this.ensureCameraPermissions(
			// 	["android.permission.READ_PHONE_STATE",
			// 		"android.permission.READ_EXTERNAL_STORAGE"
			// 	],
			// 	"我们需要您授权读取文件权限与电话权限才能正常使用此功能"
			// );
			// if (!ok) {

			// 	// 如果权限未通过，就直接返回，不执行拍照跳转
			// 	return;
			// }


			console.log('页面加载');
			// 获取本地版本号
			if (uni.getStorageSync('FACE_DTVER')) {
				this.FACE_DTVER = uni.getStorageSync('FACE_DTVER')

				console.log("----------------onLoad-------------this.FACE_DTVER---------------" + this.FACE_DTVER)
			} else {
				this.FACE_DTVER = 0
			}

			if (uni.getStorageSync('FACE_DTVER_T')) {
				this.FACE_DTVER_T = uni.getStorageSync('FACE_DTVER_T')

				console.log("----------------onLoad-------------this.FACE_DTVER_T---------------" + this.FACE_DTVER_T)
			} else {
				this.FACE_DTVER_T = 0
			}

			// 摄像头前后			
			this.ISFRONT = uni.getStorageSync('FACE_ISFRONT');

			this.ISLIVENESS = uni.getStorageSync('FACE_ISLIVENESS');

			//阈值
			this.QIFACESCORE = uni.getStorageSync('FACE_QIFACESCORE') ? uni.getStorageSync('FACE_QIFACESCORE') : 70;
			this.QIFACEQUALITY = uni.getStorageSync('FACE_QIFACEQUALITY') ? uni.getStorageSync('FACE_QIFACEQUALITY') :
				70;

			this.facePreviewSize = uni.getStorageSync('FACE_PREVIEWSIZE') ? uni.getStorageSync('FACE_PREVIEWSIZE') :
				'';

			this.idtype = e.idtype

			if (e.idtype == 1) {
				this.typetext = '校门口刷脸:' + e.vccoursetype + ' [' + e.vcschool + ']'
				this.vctype = e.vccoursetype
				this.vcschool = e.vcschool
				this.idsigntype = e.idcoursemain
				this.vccoursetype = e.vccoursetype
			} else if (e.idtype == 2) {
				this.typetext = '班内刷脸签到:' + e.vcstagename
				this.iddetail = e.idcoursedetail
				this.vcstagename = e.vcstagename
			} else if (e.idtype == 3) {
				this.typetext = '班内刷脸反馈:' + e.vcstagename
				this.iddetail = e.idcoursedetail
				this.vcstagename = e.vcstagename
			} else if (e.idtype == 4) {
				this.typetext = '托管刷脸：按时间段区分午托晚托'
				this.findInfo()
			}


			console.log('页面显示');
			var _this = this
			// 判断当前设备是否激活
			arcFaceAppreciation.getActiveFileInfo((resp) => {
				var code = resp.code;
				if (code != 0) {
					uni.showModal({
						title: '提示',
						content: '当前设备未激活请前往激活界面',
						confirmText: '激活',
						success: function(res) {
							if (res.confirm) {
								_this.gotoactivation()
								// console.log('用户点击确定');
							} else if (res.cancel) {
								// console.log('用户点击取消');
							}
						}
					});
				} else {
					this.initfaceImg()
				}
			});

		},
		onUnload() {
			arcFaceMgr.releaseResource();
		},
		onShow() {

		},
		methods: {
			/* ===================== 仅新增/替换：权限相关 begin ===================== */

			// 打开系统应用设置页（APP-PLUS 有效）
			openAppSettings() {
				// #ifdef APP-PLUS
				try {
					var Intent = plus.android.importClass("android.content.Intent");
					var Settings = plus.android.importClass("android.provider.Settings");
					var Uri = plus.android.importClass("android.net.Uri");
					var mainActivity = plus.android.runtimeMainActivity();
					var intent = new Intent();
					intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
					var uri = Uri.fromParts("package", mainActivity.getPackageName(), null);
					intent.setData(uri);
					mainActivity.startActivity(intent);
				} catch (e) {
					console.warn('openAppSettings error:', e);
				}
				// #endif
			},

			// 拒绝/永久拒绝统一弹窗处理
			async handlePermissionResult(resultObj, rationale = "为了保证功能可用，请授权所需权限") {
				const deniedAlways = (resultObj.deniedAlways || []);
				const deniedPresent = (resultObj.deniedPresent || []);

				console.log("------------------------------resultObj----------" + JSON.stringify(resultObj))

				if (deniedAlways.length > 0) {
					await new Promise((resolve) => {
						uni.showModal({
							title: '需要权限',
							content: `${rationale}\n请在系统设置中开启：\n${deniedAlways.join('\n')}`,
							confirmText: '去设置',
							success: (res) => {
								if (res.confirm) this.openAppSettings();
								resolve();
							},
							fail: () => resolve()
						});
					});
					return false;
				}
				if (deniedPresent.length > 0) {
					const again = await new Promise((resolve) => {
						uni.showModal({
							title: '权限未开启',
							content: `${rationale}\n是否再次尝试授权？\n${deniedPresent.join('\n')}`,
							confirmText: '再次授权',
							cancelText: '稍后',
							success: (res) => resolve(!!res.confirm),
							fail: () => resolve(false)
						});
					});
					return again; // true=可再发起一次申请；false=放弃
				}
				return true;
			},

			// 统一权限确保（适配 Android 13+）
			// async ensureCameraPermissions(perms = [], rationale = '') {
			// 	// #ifdef APP-PLUS
			// 	try {
			// 		const sys = uni.getSystemInfoSync();
			// 		const isAndroid = sys.platform === 'android';
			// 		let sdkInt = 0;
			// 		try {
			// 			const BuildVersion = plus.android.importClass("android.os.Build$VERSION");
			// 			sdkInt = BuildVersion.SDK_INT;
			// 		} catch (e) {}

			// 		const want = new Set(perms);
			// 		if (isAndroid && sdkInt >= 33) {
			// 			want.delete("android.permission.READ_EXTERNAL_STORAGE");
			// 			want.add("android.permission.READ_MEDIA_IMAGES"); // Android 13+ 媒体读取
			// 		} else {
			// 			want.add("android.permission.READ_EXTERNAL_STORAGE");
			// 		}
			// 		// 常用：相机权限
			// 		want.add("android.permission.CAMERA");

			// 		const main = plus.android.runtimeMainActivity();
			// 		const PM = plus.android.importClass('android.content.pm.PackageManager');
			// 		// 1. 检查是否已全部授予
			// 		let allGranted = true;
			// 		for (const p of want) {
			// 			if (main.checkSelfPermission(p) !== PM.PERMISSION_GRANTED) {
			// 				allGranted = false;
			// 				break;
			// 			}
			// 		}
			// 		if (allGranted) return true;

			// 		// 2. 弹框提示
			// 		const ok2 = await new Promise((resolve) => {
			// 			uni.showModal({
			// 				title: '权限提示',
			// 				content: rationale,
			// 				confirmText: '确定',
			// 				cancelText: '取消',
			// 				success: (res) => resolve(res.confirm)
			// 			});
			// 		});
			// 		if (!ok2) return false;

			// 		console.log("------------------------------want----------" + JSON.stringify(want))

			// 		const ok = await new Promise((resolve) => {
			// 			plus.android.requestPermissions(
			// 				Array.from(want),
			// 				async (ret) => {

			// 						console.log("------------------------------ret----------" + JSON
			// 							.stringify(ret))
			// 						const pass = await this.handlePermissionResult(ret, rationale ||
			// 							"我们需要文件/相机等权限以完成刷脸");
			// 						if (pass === true) return resolve(true);
			// 						if (pass === false) return resolve(false);
			// 						resolve(!!(ret.granted && ret.granted.length));
			// 					},
			// 					() => resolve(false)
			// 			);
			// 		});
			// 		return !!ok;
			// 	} catch (e) {
			// 		console.warn("ensureCameraPermissions error:", e);
			// 		return false;
			// 	}
			// 	// #endif
			// 	// #ifndef APP-PLUS
			// 	return true;
			// 	// #endif
			// },

			// 获取权限（仅替换权限实现，其他逻辑不改）
			requestPermission(permissions) {
				// #ifdef APP-PLUS
				try {
					const want = new Set(permissions);
					let sdkInt = 0;
					try {
						const BuildVersion = plus.android.importClass("android.os.Build$VERSION");
						sdkInt = BuildVersion.SDK_INT;
					} catch (e) {}

					if (sdkInt >= 33) {
						want.delete("android.permission.READ_EXTERNAL_STORAGE");
						want.add("android.permission.READ_MEDIA_IMAGES");
					} else {
						want.add("android.permission.READ_EXTERNAL_STORAGE");
					}
					// 一并申请相机
					want.add("android.permission.CAMERA");

					plus.android.requestPermissions(
						Array.from(want),
						async (resultObj) => {
								for (var i = 0; i < (resultObj.granted || []).length; i++) {
									var grantedPermission = resultObj.granted[i];
									// console.log('已获取的权限：' + grantedPermission);
								}
								for (var i = 0; i < (resultObj.deniedPresent || []).length; i++) {
									var deniedPresentPermission = resultObj.deniedPresent[i];
									// console.log('拒绝本次申请的权限：' + deniedPresentPermission);
								}
								for (var i = 0; i < (resultObj.deniedAlways || []).length; i++) {
									var deniedAlwaysPermission = resultObj.deniedAlways[i];
									// console.log('永久拒绝申请的权限：' + deniedAlwaysPermission);
								}

								// 统一处理：弹窗引导“再次授权/去设置”
								const pass = await this.handlePermissionResult(resultObj, "为保证激活与识别功能可用，请授权必要权限");
								// 用户选择“再次授权” -> 自动重试一轮（只对 deniedPresent）
								if (pass === true && (resultObj.deniedPresent || []).length > 0) {
									this.requestPermission(Array.from(want));
								}
							},
							function(error) {
								// console.log('申请权限错误：' + error.code + " = " + error.message);
							}
					);
				} catch (e) {
					// console.log('requestPermission 调用异常：', e);
				}
				// #endif
				// #ifndef APP-PLUS
				// 非 APP 平台不处理
				// #endif
			},

			/* ===================== 仅新增/替换：权限相关 end ===================== */

			initfaceImg() {
				this.msg = 1

				// 人脸库管理
				var arcFaceMgr = uni.requireNativePlugin("wrs-arcFaceAppreciation-arcFaceMgr");
				// 初始化
				var params = {}
				// params.pageSize = 100; // 分页查询，每页20条数据
				arcFaceMgr.initData(params);

				// 从缓存获取数据
				var loadDataParams = {};
				loadDataParams.reload = true; // true: 重新加载  false:分页加载
				arcFaceMgr.loadData(loadDataParams, (resp) => {
					if (loadDataParams.reload) {
						this.dataArray = [];
					}
					// console.log(resp);
					// console.log(resp.faceEntities)
					if (resp.faceEntities) {
						this.dataArray = resp.faceEntities;
					}

					// console.log('111110000');
					// console.log(this.dataArray);
					// 先加载学生数据，再加载教师数据
					this.findStudentImg().then(() => {
						this.findTeacherImg()
					}).catch(() => {
						// 如果学生数据加载失败，仍然尝试加载教师数据
						this.findTeacherImg()
					})

				});

			},
			// 切换摄像头
			cameraChange(e) {
				uni.setStorageSync('FACE_ISFRONT', e.target.value);
			},
			liveChange(e) {
				uni.setStorageSync('FACE_ISLIVENESS', e.target.value);
			},
			// 阈值
			sliderChange(e) {
				this.QIFACESCORE = e.detail.value
				uni.setStorageSync('FACE_QIFACESCORE', e.target.value);
				// console.log('value 发生变化：' + e.detail.value)
			},
			sliderQuality(e) {
				this.QIFACEQUALITY = e.detail.value
				uni.setStorageSync('FACE_QIFACEQUALITY', e.target.value);
			},

			// 激活
			gotoactivation() {
				let _this = this
				uni.navigateTo({
					url: '/pages/hongruan/activation',
					events: {
						// 为指定事件添加一个监听器，获取被打开页面传送到当前页面的数据
						acceptDataFromOpenedPage: function(data) {
							console.log(data)
							if (data.isactive == 1) {
								console.log(data)
								_this.FACE_DTVER = 0
								_this.initfaceImg()
							}

						},
						someEvent: function(data) {
							console.log(data)
						}
					},
				});
			},

			// 刷脸
			gotovcompare() {
				var params = {};
				params.isFront = false; // 采用前摄像头
				arcFaceParamsSetting.setCameraFront(params);

				uni.navigateTo({
					url: '/pages/hongruan/video_compare?idtype=' + this.idtype +
						'&vctype=' + this.vctype +
						'&vcschool=' + this.vcschool +
						'&idsigntype=' + this.idsigntype +
						'&iddetail=' + this.iddetail +
						'&isqt=' + this.isqt +
						'&typetext=' + this.typetext
				});
			},

			// 刷脸记录
			clickFaceRecord() {

				uni.navigateTo({
					url: '/pages/class/faceRecord?idtype=' + this.idtype +
						'&vctype=' + this.vctype +
						'&vcschool=' + this.vcschool +
						'&idsigntype=' + this.idsigntype +
						'&iddetail=' + this.iddetail +
						'&isqt=' + this.isqt +
						'&vcstagename=' + this.vcstagename +
						'&vccoursetype=' + this.vccoursetype +
						'&typetext=' + this.typetext
				});
			},

			// 初始化			
			findInfo() {
				this.apiFind({
						inObj: {
							funcapi: 'szproctec',
							procedure: 'st_pfm_config_face_se_init',
							i_idopr: uni.getStorageSync('userInfoMain').ID
						},
						outObj: 'outDataInfo'
					})
					.then((res) => {
						// 判断刷脸时间段
						this.outDataInfo.data2.forEach((item1) => {
							if (item1.ISQD == '1') {
								if (this.outDataInfo.data2.filter((item2) => {
										return item1.ID != item2.ID && ((item2.ISQD == '1' && item1.DTQDS >
											item2.DTQDS && item1.DTQDS < item2.DTQDE) || (item2
											.ISQT == '1' && item1.DTQDS > item2.DTQTS && item1
											.DTQDS < item2.DTQTE))
									}).length > 0) {
									uni.showToast({
										title: '签到签退时间段设置有重合请检查修正',
										duration: 2000
									});
									return
								}
								if (this.outDataInfo.data2.filter((item2) => {
										return item1.ID != item2.ID && ((item2.ISQD == '1' && item1.DTQDE >
											item2.DTQDS && item1.DTQDE < item2.DTQDE) || (item2
											.ISQT == '1' && item1.DTQDE > item2.DTQTS && item1
											.DTQDE < item2.DTQTE))
									}).length > 0) {
									uni.showToast({
										title: '签到签退时间段设置有重合请检查修正',
										duration: 2000
									});
									return
								}
							}
							if (item1.ISQT == '1') {
								if (this.outDataInfo.data2.filter((item2) => {
										return item1.ID != item2.ID && ((item2.ISQD == '1' && item1.DTQTS >
											item2.DTQDS && item1.DTQTS < item2.DTQDE) || (item2
											.ISQT == '1' && item1.DTQTS > item2.DTQTS && item1
											.DTQTS < item2.DTQTE))
									}).length > 0) {
									uni.showToast({
										title: '签到签退时间段设置有重合请检查修正',
										duration: 2000
									});
									return
								}

								if (this.outDataInfo.data2.filter((item2) => {
										return item1.ID != item2.ID && ((item2.ISQD == '1' && item1.DTQTE >
											item2.DTQDS && item1.DTQTE < item2.DTQDE) || (item2
											.ISQT == '1' && item1.DTQTE > item2.DTQTS && item1
											.DTQTE < item2.DTQTE))
									}).length > 0) {
									uni.showToast({
										title: '签到签退时间段设置有重合请检查修正',
										duration: 2000
									});
									return
								}
							}
						})
						this.setCurCoursetype()
					})
			},

			// 查询学生表内数据		
			loadInitImg() {
				this.FACE_DTVER = 0
				this.FACE_DTVER_T = 0
				this.initfaceImg()

			},

			async findStudentImg() {
				try {
					const response = await this.apiFind({
						inObj: {
							funcapi: 'szproctec',
							procedure: 'st_con_student_se_imgpath',
							i_idcampus: uni.getStorageSync('selCampus').ID,
							i_dtver: this.FACE_DTVER
						},
						outObj: 'outDataStudent',
					});

					// 1 删除				
					if (this.FACE_DTVER == 0) {
						// 初始化的时候清除所有本地人脸					
						await this.promiseWithTimeout(this.myclearAllFaces(), 3000).then(() => {}).catch((err) => {
							uni.showToast({
								title: '所有人脸清除失败！',
								icon: 'none',
								duration: 3000
							});
						})
					} else {
						// 单个删除人脸
						console.log('删除人脸');
						console.log(this.outDataStudent.data1);
						console.log(this.dataArray);
						for (var k in this.outDataStudent.data1) {
							for (var k1 in this.dataArray) {
								if (this.dataArray[k1].userName.split('_')[0] == this.outDataStudent.data1[k].ID) {
									var params = {};
									params.userName = this.dataArray[k1].userName;
									await this.promiseWithTimeout(this.mydeleteFace(params), 3000).then(() => {})
										.catch((err) => {
											uni.showToast({
												title: params.userName + '删除失败！',
												icon: 'none',
												duration: 3000
											});
										})
								}
							}
						}

					}
					// 2注册人脸
					console.log('注册人脸')
					console.log(this.outDataStudent.data3);
					// 5张以上人脸 添加进度条
					if (this.outDataStudent.data3.length >= 5) {
						uni.showLoading({
							title: '加载中...',
							mask: true
						});
					}

					for (var k in this.outDataStudent.data3) {
						var params = {};
						params.userName = this.outDataStudent.data3[k].ID + '_' + this.outDataStudent.data3[k].VCNAME;
						params.url = this.outDataStudent.data3[k].VCIMGPATH;
						// 超过3秒 强制返回
						await this.promiseWithTimeout(this.myregisterFace(params), 4000).then(() => {}).catch((
							err) => {
							uni.showToast({
								title: params.userName + '注册失败，请换一张学生照片',
								icon: 'none',
								duration: 4000
							});
						})
					}
					// if(this.outDataStudent.data3.length >= 5){
					uni.hideLoading();
					// }

					// 3重新载入数据
					console.log('重新载入数据');
					var loadDataParams = {};
					loadDataParams.reload = true; // true: 重新加载  false:分页加载
					await this.promiseWithTimeout(this.myloadData(loadDataParams), 3000).then(() => {}).catch((
						err) => {
						uni.showToast({
							title: '重载失败！',
							icon: 'none',
							duration: 3000
						});
					})
					// 更新版本号							
					uni.setStorageSync('FACE_DTVER', this.outDataStudent.data2[0].DTVER);


				} catch (error) {
					// console.error(error);
				}
			},



			async findTeacherImg() {
				try {
					console.log('--------findTeacherImg---------开始加载教师------------人脸数据...');

					console.log("-----------findTeacherImg-------------------FACE_DTVER_T------------" + this
						.FACE_DTVER_T)
					const response = await this.apiFind({
						inObj: {
							funcapi: 'szproctec',
							procedure: 'st_con_teacher_se_imgpath',
							i_idcampus: uni.getStorageSync('selCampus').ID,
							i_dtver: this.FACE_DTVER_T
						},
						outObj: 'outDataTeacher',
					});

					console.log("------------------outDataTeacher--------------------" + JSON.stringify(
						this.outDataTeacher))
					console.log('教师数据1长度:', this.outDataTeacher.data1 ? this.outDataTeacher.data1.length : 0);
					console.log('教师数据3长度:', this.outDataTeacher.data3 ? this.outDataTeacher.data3.length : 0);

					// 1 删除教师人脸 - 只删除教师相关的人脸
					if (this.FACE_DTVER_T == 0) {
						// 初始化时清除所有教师人脸
						for (var k1 in this.dataArray) {
							if (this.dataArray[k1].userName && this.dataArray[k1].userName.includes('_T_')) {
								var params = {};
								params.userName = this.dataArray[k1].userName;
								await this.promiseWithTimeout(this.mydeleteFace(params), 3000).then(() => {})
									.catch((err) => {
										uni.showToast({
											title: params.userName + '删除失败！',
											icon: 'none',
											duration: 3000
										});
									})
							}
						}
					} else {
						// 单个删除教师人脸
						for (var k in this.outDataTeacher.data1) {
							for (var k1 in this.dataArray) {
								if (this.dataArray[k1].userName && this.dataArray[k1].userName.split('_')[0] == this
									.outDataTeacher.data1[k].ID) {
									var params = {};
									params.userName = this.dataArray[k1].userName;
									await this.promiseWithTimeout(this.mydeleteFace(params), 3000).then(() => {})
										.catch((err) => {
											uni.showToast({
												title: params.userName + '删除失败！',
												icon: 'none',
												duration: 3000
											});
										})
								}
							}
						}
					}


					// 2注册人脸
					console.log('开始注册教师人脸...');
					// 5张以上人脸 添加进度条
					if (this.outDataTeacher.data3 && this.outDataTeacher.data3.length >= 5) {
						uni.showLoading({
							title: '加载中...',
							mask: true
						});
					}

					if (this.outDataTeacher.data3 && this.outDataTeacher.data3.length > 0) {
						for (var k in this.outDataTeacher.data3) {
							var params = {};
							// 教师人脸添加_T_前缀，与学生人脸区分
							params.userName = this.outDataTeacher.data3[k].ID + '_T_' + this.outDataTeacher.data3[k]
								.VCNAME;
							params.url = this.outDataTeacher.data3[k].VCIMGPATH;
							console.log('注册教师人脸:', params.userName, params.url);
							// 超过3秒 强制返回
							await this.promiseWithTimeout(this.myregisterFace(params), 4000).then(() => {
								console.log('教师人脸注册成功:', params.userName);
							}).catch((err) => {
								console.log('教师人脸注册失败:', params.userName, err);
								uni.showToast({
									title: params.userName + '注册失败，请换一张照片',
									icon: 'none',
									duration: 4000
								});
							})
						}
					} else {
						console.log('没有教师人脸数据需要注册');
					}

					uni.hideLoading();


					// 3重新载入数据
					var loadDataParams = {};
					loadDataParams.reload = true; // true: 重新加载  false:分页加载
					await this.promiseWithTimeout(this.myloadData(loadDataParams), 3000).then(() => {}).catch((
						err) => {
						uni.showToast({
							title: '重载失败！',
							icon: 'none',
							duration: 3000
						});
					})
					// 更新版本号							
					uni.setStorageSync('FACE_DTVER_T', this.outDataTeacher.data2[0].DTVER);

					// 开启刷脸功能
					this.isBeginFace = true
					console.log('教师人脸加载完成，开启刷脸功能');
					// 添加完成后更新本地版本
					this.$forceUpdate();

				} catch (error) {
					console.error('教师人脸加载出错:', error);
				}
			},



			// 执行超时 promise强制返回
			promiseWithTimeout(promise, timeout) {
				// 返回一个新的 Promise 对象
				return Promise.race([
					// Promise 的执行函数包装在 Promise.resolve() 中
					Promise.resolve(promise),
					// 设置一个定时器，如果超时则 reject Promise
					new Promise((resolve, reject) => {
						setTimeout(() => {
							reject(new Error('执行超时返回'));
						}, timeout);
					})
				]);
			},
			// 注册单个人脸
			async myregisterFace(apara) {
				return new Promise((resolve, reject) => {
					arcFaceMgr.registerFace(apara, (resp) => {
						// resolve(resp)
						console.log(JSON.stringify(resp));
						console.log('注册人脸' + apara);
						var code = resp.code;
						if (code == 0) { // 注册成功
							resolve(resp)
						} else { // 注册失败
							reject(apara.userName + '注册失败，请换一张学生照片');
						}
					});
				})
			},

			// 清空所有人脸
			async myclearAllFaces() {
				return new Promise((resolve, reject) => {

					arcFaceMgr.clearAllFaces((resp) => {
						console.log('清除所有人脸');
						resolve(resp)
					});
				})
			},

			// 删除单个人脸
			async mydeleteFace(apara) {
				return new Promise((resolve, reject) => {
					arcFaceMgr.deleteFace(apara, (resp) => {
						// console.log(JSON.stringify(resp));
						// console.log('删除人脸');
						resolve(resp)
					});
				})
			},
			async myloadData(apara) {
				return new Promise((resolve, reject) => {
					arcFaceMgr.loadData(apara, (resp) => {
						if (apara.reload) {
							this.dataArray = [];
						}
						// console.log(resp.faceEntities)
						if (resp.faceEntities) {
							this.dataArray = resp.faceEntities;
							console.log('人脸数据重载数组');
							console.log(this.dataArray);
						}
						resolve(resp)
					});
				})
			},

			setCurCoursetype() {
				let c_date = new Date()

				let c_hm = ((c_date.getHours() + 100) + '').substr(1, 2) + ':' + ((c_date.getMinutes() + 100) + '').substr(
					1, 2)
				let v_idsigntype = 0
				let v_vcname = ''

				let qdList = this.outDataInfo.data2.filter((item) => {
					return item.ISQD == '1' && c_hm > item.DTQDS && c_hm < item.DTQDE
				})
				if (qdList && qdList.length == 1) {
					this.isqd = 1
					v_idsigntype = qdList[0].ID
					v_vcname = qdList[0].VCNAME
				} else {
					this.isqd = 0
				}

				let qtList = this.outDataInfo.data2.filter((item) => {
					return item.ISQT == '1' && c_hm > item.DTQTS && c_hm < item.DTQTE
				})
				if (qtList && qtList.length == 1) {
					this.isqt = 1
					v_idsigntype = '100' + qtList[0].ID
					v_vcname = qtList[0].VCNAME
				} else {
					this.isqt = 0
				}

				if (v_idsigntype == 0) {
					this.typetext = '托管刷脸：未在刷脸时间段'
					this.faceText = '未在刷脸时间段'
					this.$forceUpdate()
				}

				// 签到时间段有跳转
				if (this.idsigntype != v_idsigntype) {
					if (v_idsigntype == 0) {
						this.typetext = '托管刷脸：未在刷脸时间段'
						this.faceText = '未在刷脸时间段'
						this.$forceUpdate()
					} else {
						this.typetext = '托管刷脸：' + v_vcname + ((this.isqt == 1) ? '签退' : '签到')
						this.faceText = v_vcname + ((this.isqt == 1) ? '签退' : '签到')
						this.$forceUpdate()
					}
					// 已识别的记录 清空，可以再次识别
					this.stuIDList = []
					this.idsigntype = v_idsigntype
				}

				// 卡住时间会 推后， 造成初始的时候，有等待执行的情况
				setTimeout(() => {
					this.setCurCoursetype()
				}, 60000);
			},

			delFace() {
				arcFaceMgr.clearAllFaces((resp) => {});
			},

			getSize() {
				// 先获取设备支持的分辨率，然后再选择一个来设置
				arcFaceParamsSetting.getCommonSupportedPreviewSize((resp) => {
					if (resp.commonSupportedPreviewSize) {
						this.listSize = resp.commonSupportedPreviewSize

					}
				});
			},
			setSize(e) {
				console.log(e);
				console.log(this.listSize)

				this.facePreviewSize = this.listSize[e.target.value]

				var params = {};
				params.previewSize = this.facePreviewSize;
				arcFaceParamsSetting.setPreviewSize(params);

				uni.setStorageSync('FACE_PREVIEWSIZE', this.facePreviewSize);

				this.$forceUpdate()
			}
		}
	}
</script>

<style lang="scss" scoped>
	page {
		background-color: #F3F4F9;
	}

	.card {
		background-color: #FFFFFF;
		border: 1px solid #dcdcdc;
		border-radius: 10rpx;
		box-shadow: 0rpx 3rpx 4rpx 0rpx rgba(220, 220, 220, 0.2);
	}

	.card_top {
		padding: 20rpx 30rpx;
		text-align: left;
		border-bottom: 1px solid #dcdcdc;
	}

	.card_bottom {
		padding: 30rpx;
		text-align: center;
	}

	.text {
		font-size: 14px;
	}

	.item {
		margin-bottom: 18px;
	}


	.see {
		position: relative;
	}

	.see canvas {
		position: absolute;
		top: 0;
		left: 0;
	}

	a {
		color: #42b983;
	}

	.spin {
		display: block;
		width: 40px;
		height: 40px;
		margin: 30px auto;
		border: 3px solid transparent;
		border-radius: 50%;
		border-top-color: #23D9B5;
		animation: spin 2s ease infinite;
	}

	@keyframes spin {
		to {
			-webkit-transform: rotateZ(360deg)
		}
	}

	.el-form-item {
		margin-bottom: 0px;
		margin-top: 0px;
	}

	.el-card ::v-deep .el-card__body {
		padding-top: 5px;
		padding-bottom: 8px;
	}
</style>