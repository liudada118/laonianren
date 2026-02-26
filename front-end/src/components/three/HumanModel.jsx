import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'

export function HumanModel({ type = 'sitstand', isRecording = false }) {
  const containerRef = useRef(null)
  const sceneRef = useRef(null)
  const rendererRef = useRef(null)
  const animationRef = useRef(null)
  const modelRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Scene setup
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xBCC6D0)
    sceneRef.current = scene

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      45,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    )
    camera.position.set(0, 1, 6)

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(5, 10, 5)
    directionalLight.castShadow = true
    scene.add(directionalLight)

    // Create human figure
    const humanGroup = new THREE.Group()
    modelRef.current = humanGroup

    const bodyMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x9CA3AF,
      roughness: 0.6,
      metalness: 0.2
    })

    // Head
    const headGeometry = new THREE.SphereGeometry(0.25, 32, 32)
    const head = new THREE.Mesh(headGeometry, bodyMaterial)
    head.position.set(0, 2.2, 0)
    head.castShadow = true
    humanGroup.add(head)

    // Torso
    const torsoGeometry = new THREE.CylinderGeometry(0.3, 0.25, 1.2, 16)
    const torso = new THREE.Mesh(torsoGeometry, bodyMaterial)
    torso.position.set(0, 1.4, 0)
    torso.castShadow = true
    humanGroup.add(torso)

    // Arms
    const armGeometry = new THREE.CapsuleGeometry(0.08, 0.8, 8, 16)
    
    const leftArm = new THREE.Mesh(armGeometry, bodyMaterial)
    leftArm.position.set(-0.45, 1.5, 0)
    leftArm.rotation.z = 0.2
    leftArm.castShadow = true
    humanGroup.add(leftArm)

    const rightArm = new THREE.Mesh(armGeometry, bodyMaterial)
    rightArm.position.set(0.45, 1.5, 0)
    rightArm.rotation.z = -0.2
    rightArm.castShadow = true
    humanGroup.add(rightArm)

    // Legs
    const legGeometry = new THREE.CapsuleGeometry(0.1, 1.0, 8, 16)
    
    const leftLeg = new THREE.Mesh(legGeometry, bodyMaterial)
    leftLeg.position.set(-0.15, 0.3, 0)
    leftLeg.castShadow = true
    leftLeg.name = 'leftLeg'
    humanGroup.add(leftLeg)

    const rightLeg = new THREE.Mesh(legGeometry, bodyMaterial)
    rightLeg.position.set(0.15, 0.3, 0)
    rightLeg.castShadow = true
    rightLeg.name = 'rightLeg'
    humanGroup.add(rightLeg)

    // Chair (for sit-stand)
    if (type === 'sitstand') {
      const chairGroup = new THREE.Group()
      
      const seatGeometry = new THREE.BoxGeometry(0.8, 0.1, 0.6)
      const seatMaterial = new THREE.MeshStandardMaterial({ color: 0x6B7280 })
      const seat = new THREE.Mesh(seatGeometry, seatMaterial)
      seat.position.set(0, 0.5, -0.2)
      chairGroup.add(seat)

      const backGeometry = new THREE.BoxGeometry(0.8, 1.0, 0.1)
      const back = new THREE.Mesh(backGeometry, seatMaterial)
      back.position.set(0, 1.0, -0.45)
      chairGroup.add(back)

      scene.add(chairGroup)
    }

    // Platform for standing
    if (type === 'standing' || type === 'gait') {
      const platformGeometry = new THREE.BoxGeometry(2, 0.1, 2)
      const platformMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x4B5563,
        roughness: 0.8
      })
      const platform = new THREE.Mesh(platformGeometry, platformMaterial)
      platform.position.set(0, -0.25, 0)
      platform.receiveShadow = true
      scene.add(platform)
    }

    scene.add(humanGroup)

    // Grid helper
    const gridHelper = new THREE.GridHelper(10, 20, 0xffffff, 0xffffff)
    gridHelper.material.opacity = 0.1
    gridHelper.material.transparent = true
    gridHelper.position.y = -0.3
    scene.add(gridHelper)

    // Animation variables
    let animationTime = 0

    // Animation loop
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate)
      animationTime += 0.02

      if (isRecording && modelRef.current) {
        // Animate based on type
        if (type === 'sitstand') {
          // Sit-stand animation
          const standProgress = (Math.sin(animationTime) + 1) / 2
          modelRef.current.position.y = standProgress * 0.3
          
          const leftLeg = modelRef.current.getObjectByName('leftLeg')
          const rightLeg = modelRef.current.getObjectByName('rightLeg')
          if (leftLeg && rightLeg) {
            leftLeg.rotation.x = standProgress * 0.3
            rightLeg.rotation.x = standProgress * 0.3
          }
        } else if (type === 'standing') {
          // Slight sway animation
          modelRef.current.rotation.z = Math.sin(animationTime * 0.5) * 0.02
          modelRef.current.rotation.x = Math.cos(animationTime * 0.3) * 0.01
        } else if (type === 'gait') {
          // Walking animation
          const leftLeg = modelRef.current.getObjectByName('leftLeg')
          const rightLeg = modelRef.current.getObjectByName('rightLeg')
          if (leftLeg && rightLeg) {
            leftLeg.rotation.x = Math.sin(animationTime * 2) * 0.3
            rightLeg.rotation.x = Math.sin(animationTime * 2 + Math.PI) * 0.3
          }
          modelRef.current.position.x = Math.sin(animationTime * 0.5) * 0.5
        }
      }

      renderer.render(scene, camera)
    }
    animate()

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current) return
      const width = containerRef.current.clientWidth
      const height = containerRef.current.clientHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement)
        rendererRef.current.dispose()
      }
    }
  }, [type, isRecording])

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full"
      style={{ minHeight: '400px' }}
    />
  )
}

export default HumanModel
